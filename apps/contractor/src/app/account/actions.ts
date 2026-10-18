"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { errorMessage, fail, bool, optStr, str } from "@homefax/app-kit";
import { isStageId } from "@homefax/core";
import { auth, canBuild, orgs, people, records, withService } from "@homefax/db";
import { kit } from "@/lib/kit";
import { verifyKey } from "@/lib/legacy-keys";
import { orgContext, setActiveOrgCookie } from "@/lib/session";
import { CLAIM_CODE_COOKIE, RESET_LINK_COOKIE, clearShowOnce, writeShowOnce, type IssuedResetLink } from "@/lib/show-once";

/**
 * Every account-layer mutation, one file. Convention:
 *   - input is a plain <form> FormData, read with the app-kit helpers
 *   - the repo runs under the signed-in actor (kit.asMe); row-level security
 *     is the authorisation. withService appears only for sign-in, sign-up,
 *     resets, the member lookup, the legacy claim and the hire acceptance —
 *     each named in the repo's doc comment.
 *   - success redirects to the page that shows the result
 *   - failure redirects back with ?error=<message> via fail(), so every page
 *     stays a server component with no client state.
 *
 * Field names are the contract with the pages — keep them exactly as
 * documented on each action.
 */

/* ------------------------------- sign in --------------------------------- */

/** Fields: name, email, password, handle (optional — derived from name if absent), headline (optional). Success → /records. Failure → /?mode=signup&error=… */
export async function signUpAction(formData: FormData): Promise<void> {
  const name = str(formData, "name");
  const email = str(formData, "email");
  const password = String(formData.get("password") ?? "");
  const handle = optStr(formData, "handle");
  const headline = optStr(formData, "headline");
  if (!name) fail("/?mode=signup", "Name is required");
  if (!email) fail("/?mode=signup", "Email is required");

  let token: string;
  try {
    const { ip, userAgent } = await kit.clientInfo();
    const r = await withService((tx) =>
      auth.signUp(tx, { email, password, name, handle: handle ?? undefined, headline: headline ?? undefined, app: "contractor", ip, userAgent }),
    );
    token = r.token;
  } catch (e) {
    fail("/?mode=signup", errorMessage(e));
  }
  await kit.setSessionCookie(token);
  redirect("/records");
}

/** Fields: email, password. Success → /records. Failure → /?mode=signin&error=… */
export async function signInAction(formData: FormData): Promise<void> {
  const email = str(formData, "email");
  const password = String(formData.get("password") ?? "");
  if (!email || !password) fail("/?mode=signin", "Enter your email and password");

  let result: auth.SignInResult;
  try {
    const { ip, userAgent } = await kit.clientInfo();
    result = await withService((tx) => auth.signIn(tx, { email, password, app: "contractor", ip, userAgent }));
  } catch (e) {
    fail("/?mode=signin", errorMessage(e));
  }
  if (!result.ok) {
    if (result.reason === "locked") {
      const minutes = Math.max(1, Math.ceil((result.retryAfterMs ?? 0) / 60_000));
      fail("/?mode=signin", `Too many attempts — try again in ${minutes} minute${minutes === 1 ? "" : "s"}`);
    }
    if (result.reason === "suspended") fail("/?mode=signin", "This account is suspended");
    fail("/?mode=signin", "That email and password do not match");
  }
  await kit.setSessionCookie(result.token);
  redirect("/records");
}

/** No fields. Revokes this session and drops the cookie → /. */
export async function signOutAction(): Promise<void> {
  await kit.signOut();
  redirect("/");
}

/** No fields. Revokes every other session of this person, on every device and app → /profile?ok=sessions. */
export async function revokeOtherSessionsAction(): Promise<void> {
  let n = 0;
  try {
    n = await kit.asMe((tx, me) => auth.revokeOtherSessions(tx, me.identity.id, me.session.id));
  } catch (e) {
    fail("/profile", errorMessage(e));
  }
  revalidatePath("/profile");
  redirect(`/profile?ok=sessions&n=${n}`);
}

/* ------------------------------ passwords -------------------------------- */

/** Fields: currentPassword, password, confirm. Success → /profile?ok=password. Failure → /profile?error=… */
export async function changePasswordAction(formData: FormData): Promise<void> {
  const me = await kit.requirePrincipal();
  const current = String(formData.get("currentPassword") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password !== confirm) fail("/profile", "The two new passwords do not match");
  try {
    // Credentials are service-only rows; the repo verifies the current password first.
    await withService((tx) => auth.changePassword(tx, me.identity.id, current, password));
  } catch (e) {
    fail("/profile", errorMessage(e));
  }
  revalidatePath("/profile");
  redirect("/profile?ok=password");
}

/**
 * Fields: membershipId. An owner or admin of the company issues a one-time
 * reset link for that member (never for the owner — the owner recovers via the
 * operator script). The link is shown once on /team and never stored in clear.
 * Success → /team. Failure → /team?error=…
 */
export async function issueResetLinkAction(formData: FormData): Promise<void> {
  const membershipId = str(formData, "membershipId");
  let issued: IssuedResetLink;
  try {
    const target = await kit.asMe(async (tx, me) => {
      const t = await orgs.getMembershipById(tx, membershipId);
      if (!t) throw new Error("Membership not found");
      if (t.role === "owner") throw new Error("The owner's password cannot be reset from here");
      const caller = await orgs.getMembership(tx, t.orgId, me.identity.id);
      if (!caller || caller.role === "member") throw new Error("Only owners and admins can issue reset links");
      if (t.role === "admin" && caller.role !== "owner") throw new Error("Only the owner can reset an admin's password");
      const names = await records.namesFor(tx, [t.identityId]);
      return { membership: t, name: names.get(t.identityId) ?? "this member", issuedBy: me.identity.id };
    });
    const { token, expiresAt } = await withService((tx) =>
      auth.createPasswordReset(tx, { identityId: target.membership.identityId, issuedBy: target.issuedBy }),
    );
    const origin = await kit.origin();
    issued = {
      membershipId,
      userName: target.name,
      link: `${origin}/reset?token=${encodeURIComponent(token)}`,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (e) {
    fail("/team", errorMessage(e));
  }
  await writeShowOnce(RESET_LINK_COOKIE, "/team", issued, auth.RESET_TOKEN_MINUTES * 60);
  revalidatePath("/team");
  redirect("/team");
}

/** No fields. Clears the shown reset link from /team (the link itself stays valid until it expires or is used). */
export async function dismissResetLinkAction(): Promise<void> {
  await clearShowOnce(RESET_LINK_COOKIE, "/team");
  redirect("/team");
}

/** Fields: token, password, confirm. Sets the password, burns the token, revokes old sessions, signs the person in. Success → /records. Failure → /reset?token=…&error=… */
export async function resetPasswordAction(formData: FormData): Promise<void> {
  const token = str(formData, "token");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const back = `/reset?token=${encodeURIComponent(token)}`;
  if (!token) fail("/reset", "This reset link is not valid or has expired");
  if (password !== confirm) fail(back, "The two passwords do not match");

  let sessionToken: string;
  try {
    const { ip, userAgent } = await kit.clientInfo();
    sessionToken = await withService(async (tx) => {
      const identityId = await auth.consumePasswordReset(tx, token, password);
      return (await auth.startSession(tx, { identityId, app: "contractor", ip, userAgent })).token;
    });
  } catch (e) {
    const msg = errorMessage(e);
    fail(/not valid/i.test(msg) ? "/reset" : back, msg);
  }
  await kit.setSessionCookie(sessionToken);
  redirect("/records");
}

/* ------------------------------- profile --------------------------------- */

/** Fields: name, handle, headline, bio, isPublic ("on" when checked). Success → /profile. */
export async function updateProfileAction(formData: FormData): Promise<void> {
  try {
    await kit.asMe((tx, me) =>
      people.updateProfile(tx, me.identity.id, {
        name: str(formData, "name"),
        handle: str(formData, "handle"),
        headline: optStr(formData, "headline"),
        bio: optStr(formData, "bio"),
        isPublic: bool(formData, "isPublic"),
      }),
    );
  } catch (e) {
    fail("/profile", errorMessage(e));
  }
  revalidatePath("/profile");
  redirect("/profile");
}

/* ------------------------------ companies -------------------------------- */

/** Fields: name, headline (optional). Creates the company with the caller as owner and makes it active. Success → /team. */
export async function createCompanyAction(formData: FormData): Promise<void> {
  const name = str(formData, "name");
  const headline = optStr(formData, "headline");
  if (!name) fail("/team", "Company name is required");
  let orgId: string;
  try {
    const org = await kit.asMe((tx, me) => orgs.createOrg(tx, { kind: "contractor", name, headline, ownerIdentityId: me.identity.id }));
    orgId = org.id;
  } catch (e) {
    fail("/team", errorMessage(e));
  }
  await setActiveOrgCookie(orgId);
  revalidatePath("/team");
  revalidatePath("/records");
  redirect("/team");
}

/** Fields: orgId, name, headline, bio, isPublic. Owner/admin only (row-level security refuses the rest). Success → /team. */
export async function updateCompanyAction(formData: FormData): Promise<void> {
  const orgId = str(formData, "orgId");
  try {
    await kit.asMe(async (tx, me) => {
      const m = await orgs.getMembership(tx, orgId, me.identity.id);
      if (!m || m.role === "member") throw new Error("Only owners and admins can update company details");
      await orgs.updateOrg(tx, orgId, {
        name: str(formData, "name"),
        headline: optStr(formData, "headline"),
        bio: optStr(formData, "bio"),
        isPublic: bool(formData, "isPublic"),
      });
    });
  } catch (e) {
    fail("/team", errorMessage(e));
  }
  revalidatePath("/team");
  redirect("/team");
}

/** Fields: orgId. Rotates the company's hfx_ key. Owner/admin only. Success → /team. */
export async function regenerateHfxKeyAction(formData: FormData): Promise<void> {
  const orgId = str(formData, "orgId");
  try {
    await kit.asMe(async (tx, me) => {
      const m = await orgs.getMembership(tx, orgId, me.identity.id);
      if (!m || m.role === "member") throw new Error("Only owners and admins can regenerate the HomeFAX key");
      await orgs.regenerateHfxKey(tx, orgId);
    });
  } catch (e) {
    fail("/team", errorMessage(e));
  }
  revalidatePath("/team");
  redirect("/team");
}

/** Fields: orgId, secret (a legacy ACCESS_KEYS secret). Verifies the key, then claims that key's records for the org. Success → /records?claimed=N. */
export async function claimLegacyKeyAction(formData: FormData): Promise<void> {
  const orgId = str(formData, "orgId");
  const secret = str(formData, "secret");
  let count = 0;
  try {
    await kit.asMe(async (tx, me) => {
      const m = await orgs.getMembership(tx, orgId, me.identity.id);
      if (!m || m.role === "member") throw new Error("Only owners and admins can claim a legacy key");
    });
    const key = verifyKey(secret);
    if (!key) throw new Error("That key was not recognised");
    // Service: the records being claimed have no org yet, so nobody but the platform can see them.
    count = await withService((tx) => records.claimLegacyRecords(tx, orgId, key.id));
  } catch (e) {
    fail("/team", errorMessage(e));
  }
  revalidatePath("/records");
  revalidatePath("/team");
  redirect(`/records?claimed=${count}`);
}

/** Fields: orgId. Sets the acting-company cookie. Success → /records. */
export async function setActiveOrgAction(formData: FormData): Promise<void> {
  const orgId = str(formData, "orgId");
  try {
    await kit.asMe(async (tx, me) => {
      const m = await orgs.getMembership(tx, orgId, me.identity.id);
      if (!m) throw new Error("You are not a member of that company");
    });
  } catch (e) {
    fail("/records", errorMessage(e));
  }
  await setActiveOrgCookie(orgId);
  redirect("/records");
}

/* -------------------------------- members -------------------------------- */

/** Fields: orgId, who (email or @handle of an existing account), title (optional), role ("member"|"admin"). Owner/admin only. Success → /team. */
export async function addMemberAction(formData: FormData): Promise<void> {
  const orgId = str(formData, "orgId");
  const who = str(formData, "who");
  const title = optStr(formData, "title");
  const role = str(formData, "role") === "admin" ? "admin" : "member";
  if (!who) fail("/team", "Enter an email or handle");
  try {
    // The lookup runs as the service (actors cannot read other identities); the insert as the actor, so the admin policy applies.
    const identityId = await withService((tx) => orgs.findIdentityIdByEmailOrHandle(tx, who));
    if (!identityId) throw new Error("No account found for that email or handle");
    await kit.asMe((tx) => orgs.addMember(tx, { orgId, identityId, role, title }));
  } catch (e) {
    fail("/team", errorMessage(e));
  }
  revalidatePath("/team");
  redirect("/team");
}

/** Fields: membershipId. Owner/admin only; the owner membership cannot be removed. Success → /team. */
export async function removeMemberAction(formData: FormData): Promise<void> {
  const membershipId = str(formData, "membershipId");
  try {
    await kit.asMe(async (tx, me) => {
      const t = await orgs.getMembershipById(tx, membershipId);
      if (!t) throw new Error("Membership not found");
      const caller = await orgs.getMembership(tx, t.orgId, me.identity.id);
      if (!caller || caller.role === "member") throw new Error("Only owners and admins can remove members");
      await orgs.removeMember(tx, membershipId);
    });
  } catch (e) {
    fail("/team", errorMessage(e));
  }
  revalidatePath("/team");
  redirect("/team");
}

/* ------------------------- project team & access -------------------------- */

/** Fields: recordId, hfxKey. Adds the company holding that HomeFAX key to the project as collaborator. Caller must be able to build on the record. Success → the record page. */
export async function addCompanyByKeyAction(formData: FormData): Promise<void> {
  const recordId = str(formData, "recordId");
  const hfxKey = str(formData, "hfxKey");
  let slug = "";
  try {
    const { record, addedBy } = await kit.asMe(async (tx, me) => {
      const record = await records.getRecord(tx, recordId);
      if (!record) throw new Error("Record not found");
      if (!(await canBuild(tx, record.propertyId))) throw new Error("You do not have permission to do that");
      return { record, addedBy: me.identity.id };
    });
    slug = record.slug;
    if (!hfxKey) throw new Error("Paste the company's HomeFAX key");
    // Service: a key is only resolvable by the platform — an actor cannot enumerate companies by key.
    await withService((tx) => records.addOrgToRecordByKey(tx, { recordId, hfxKey, addedBy }));
  } catch (e) {
    fail(slug ? `/records/${slug}` : "/records", errorMessage(e));
  }
  revalidatePath(`/records/${slug}`);
  redirect(`/records/${slug}`);
}

/**
 * Fields: recordId, assignee ("u:<identityId>" for a person, "o:<orgId>" for a
 * company), task, stage (optional StageId). Caller must be able to build on the
 * record. An assigned company is also seated on the project team so its people
 * can open the record. Success → the record page.
 */
export async function assignAction(formData: FormData): Promise<void> {
  const recordId = str(formData, "recordId");
  const assignee = str(formData, "assignee");
  const task = str(formData, "task");
  const stage = optStr(formData, "stage");
  let slug = "";
  try {
    await kit.asMe(async (tx, me) => {
      const record = await records.getRecord(tx, recordId);
      if (!record) throw new Error("Record not found");
      slug = record.slug;
      if (!task) throw new Error("Describe the work");
      const assigneeIdentityId = assignee.startsWith("u:") ? assignee.slice(2) : null;
      const assigneeOrgId = assignee.startsWith("o:") ? assignee.slice(2) : null;
      if (!assigneeIdentityId && !assigneeOrgId) throw new Error("Choose who the work goes to");
      await records.createAssignment(tx, {
        recordId,
        assigneeIdentityId,
        assigneeOrgId,
        task,
        stage: stage && isStageId(stage) ? stage : null,
        assignedBy: me.identity.id,
      });
      if (assigneeOrgId) {
        await records.grantRecordAccess(tx, { recordId, orgId: assigneeOrgId, role: "collaborator", addedBy: me.identity.id });
      }
    });
  } catch (e) {
    fail(slug ? `/records/${slug}` : "/records", errorMessage(e));
  }
  revalidatePath(`/records/${slug}`);
  redirect(`/records/${slug}`);
}

/** Fields: assignmentId, status ("done"|"open"). The assignee, their company, or anyone who can build on the record. Success → the record page. */
export async function setAssignmentStatusAction(formData: FormData): Promise<void> {
  const assignmentId = str(formData, "assignmentId");
  const status = str(formData, "status") === "done" ? "done" : "open";
  let slug = "";
  try {
    await kit.asMe(async (tx) => {
      const a = await records.getAssignment(tx, assignmentId);
      if (!a) throw new Error("Assignment not found");
      const record = await records.getRecord(tx, a.recordId);
      slug = record?.slug ?? "";
      await records.setAssignmentStatus(tx, assignmentId, status);
    });
  } catch (e) {
    fail(slug ? `/records/${slug}` : "/records", errorMessage(e));
  }
  revalidatePath(slug ? `/records/${slug}` : "/records");
  redirect(slug ? `/records/${slug}` : "/records");
}

/* --------------------------------- hiring --------------------------------- */

/**
 * Fields: to ("u:<identityId>" | "o:<orgId>"), task, note (optional), recordId
 * (optional — ties the offer to a property). Sent from the caller's active
 * company. Success → /hire.
 */
export async function hireAction(formData: FormData): Promise<void> {
  const to = str(formData, "to");
  const task = str(formData, "task");
  const note = optStr(formData, "note");
  const recordId = optStr(formData, "recordId");
  if (!task) fail("/hire", "Describe the work");
  try {
    await kit.asMe(async (tx, me) => {
      const { org } = await orgContext(tx, me);
      if (!org) throw new Error("Create your company first");
      const toIdentityId = to.startsWith("u:") ? to.slice(2) : null;
      const toOrgId = to.startsWith("o:") ? to.slice(2) : null;
      if (!toIdentityId && !toOrgId) throw new Error("Choose who the offer goes to");
      await records.createHire(tx, { fromOrgId: org.id, toIdentityId, toOrgId, task, recordId, note, createdBy: me.identity.id });
    });
  } catch (e) {
    fail("/hire", errorMessage(e));
  }
  revalidatePath("/hire");
  redirect("/hire");
}

/**
 * Fields: hireId, decision ("accept"|"decline"). Only the addressee (the
 * person, or an owner/admin of the addressed company). Accepting an offer that
 * names a property creates the assignment (and collaborator access for an
 * addressed company) so it appears on the hired side immediately — that step
 * runs as the service, because the addressee has no build rights on the record
 * until it happens (see records.acceptHire). Success → /hire.
 */
export async function respondHireAction(formData: FormData): Promise<void> {
  const hireId = str(formData, "hireId");
  const decision = str(formData, "decision");
  try {
    const { me, hire, adminOrgIds } = await kit.asMe(async (tx, me) => {
      const hire = await records.getHire(tx, hireId);
      if (!hire) throw new Error("Offer not found");
      const mine = await orgs.listOrgsForIdentity(tx, me.identity.id);
      const adminOrgIds = mine.filter((o) => o.role === "owner" || o.role === "admin").map((o) => o.id);
      const addressee = hire.toIdentityId === me.identity.id || (hire.toOrgId != null && adminOrgIds.includes(hire.toOrgId));
      if (!addressee) throw new Error("You are not the addressee of this offer");
      if (decision === "decline") await records.setHireStatus(tx, hireId, "declined");
      return { me, hire, adminOrgIds };
    });
    if (decision === "accept" && hire.status === "offered") {
      await withService((tx) => records.acceptHire(tx, { hireId, identityId: me.identity.id, adminOrgIds }));
    }
  } catch (e) {
    fail("/hire", errorMessage(e));
  }
  revalidatePath("/hire");
  redirect("/hire");
}

/* ------------------------------ claim codes ------------------------------- */

/** No fields. Clears the claim code shown on a record page (the code itself stays valid until it is used or expires). Fields: slug. */
export async function dismissClaimCodeAction(formData: FormData): Promise<void> {
  const slug = str(formData, "slug");
  await clearShowOnce(CLAIM_CODE_COOKIE, "/records");
  redirect(slug ? `/records/${slug}` : "/records");
}
