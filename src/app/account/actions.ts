"use server";

import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ORG_COOKIE,
  activeOrg,
  addMembership,
  canAccessRecord,
  claimLegacyRecords,
  createAssignment,
  createHire,
  createOrg,
  createUser,
  getAssignment,
  getHire,
  getMembership,
  getMembershipById,
  getOrgByHfxKey,
  getUserByEmail,
  getUserByHandle,
  grantProjectAccess,
  removeMembership,
  requireUser,
  setAssignmentStatus,
  setHireStatus,
  updateOrg,
  updateUser,
} from "@/lib/accounts";
import {
  endSession,
  hashPassword,
  mintHfxKey,
  startSession,
  verifyKey,
  verifyPassword,
} from "@/lib/auth";
import { getRecordById } from "@/lib/store";

/**
 * Every account-layer mutation, one file. Convention:
 *   - input is a plain <form> FormData
 *   - success redirects to the page that shows the result
 *   - failure redirects back to the calling page with ?error=<message>
 *     (and keeps any mode/tab parameter the page needs), so every page stays a
 *     server component with no client state.
 *
 * Field names are the contract with the pages — keep them exactly as
 * documented on each action.
 */

function err(msg: string): string {
  return encodeURIComponent(msg);
}

function slugifyHandle(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24) || "user"
  );
}

/* ------------------------------- sign in --------------------------------- */

/** Fields: name, email, password, handle (optional — derived from name if absent), headline (optional). Success → /records. Failure → /?mode=signup&error=… */
export async function signUpAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const rawHandle = String(formData.get("handle") ?? "").trim();
  const headline = String(formData.get("headline") ?? "").trim();

  if (!name) redirect(`/?mode=signup&error=${err("Name is required")}`);
  if (!email) redirect(`/?mode=signup&error=${err("Email is required")}`);
  if (password.length < 8) redirect(`/?mode=signup&error=${err("Password must be at least 8 characters")}`);

  // Derive handle from name if not supplied
  let handle = rawHandle ? rawHandle.toLowerCase().trim() : slugifyHandle(name);
  if (handle.length < 3) handle = handle.padEnd(3, "0");

  // Suffix on collision for derived handles
  if (!rawHandle) {
    const base = handle;
    for (let i = 0; i < 10; i++) {
      const clash = await getUserByHandle(handle);
      if (!clash) break;
      handle = `${base.slice(0, 20)}-${nanoid(4).toLowerCase()}`;
    }
  }

  let userId: string | null = null;
  let createError: string | null = null;
  try {
    const user = await createUser({
      email,
      passwordHash: hashPassword(password),
      name,
      handle,
      headline: headline || undefined,
    });
    userId = user.id;
  } catch (e) {
    createError = e instanceof Error ? e.message : "Something went wrong";
  }

  if (createError || !userId) {
    redirect(`/?mode=signup&error=${err(createError ?? "Something went wrong")}`);
  }

  await startSession(userId!);
  redirect("/records");
}

/** Fields: email, password. Success → /records. Failure → /?mode=signin&error=… */
export async function signInAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");

  let signInError: string | null = null;
  let userId: string | null = null;

  const user = await getUserByEmail(email);
  if (!user) {
    signInError = "No account found for that email";
  } else if (!verifyPassword(password, user.passwordHash)) {
    signInError = "Incorrect password";
  } else {
    userId = user.id;
  }

  if (signInError || !userId) {
    redirect(`/?mode=signin&error=${err(signInError ?? "Sign in failed")}`);
  }

  await startSession(userId!);
  redirect("/records");
}

/** No fields. Ends the session → /. */
export async function signOutAction(): Promise<void> {
  await endSession();
  redirect("/");
}

/* ------------------------------- profile --------------------------------- */

/** Fields: name, handle, headline, bio, isPublic ("on" when checked). Success → /profile. */
export async function updateProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const handle = String(formData.get("handle") ?? "").toLowerCase().trim();
  const headline = String(formData.get("headline") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();
  const isPublic = formData.get("isPublic") === "on";

  let updateError: string | null = null;
  try {
    await updateUser(user.id, {
      name: name || undefined,
      handle: handle || undefined,
      headline: headline || undefined,
      bio: bio || undefined,
      isPublic,
    });
  } catch (e) {
    updateError = e instanceof Error ? e.message : "Update failed";
  }

  if (updateError) {
    redirect(`/profile?error=${err(updateError)}`);
  }

  revalidatePath("/profile");
  redirect("/profile");
}

/* ------------------------------ companies -------------------------------- */

/** Fields: name, headline (optional). Creates org + owner membership, makes it active. Success → /team. */
export async function createCompanyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const headline = String(formData.get("headline") ?? "").trim();

  if (!name) redirect(`/team?error=${err("Company name is required")}`);

  let org: Awaited<ReturnType<typeof createOrg>> | null = null;
  let createError: string | null = null;
  try {
    org = await createOrg({ name, ownerUserId: user.id, headline: headline || undefined });
  } catch (e) {
    createError = e instanceof Error ? e.message : "Failed to create company";
  }

  if (createError || !org) {
    redirect(`/team?error=${err(createError ?? "Failed to create company")}`);
  }

  const jar = await cookies();
  jar.set(ORG_COOKIE, org!.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });

  revalidatePath("/team");
  redirect("/team");
}

/** Fields: orgId, name, headline, bio, isPublic. Caller must be owner/admin. Success → /team. */
export async function updateCompanyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const orgId = String(formData.get("orgId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const headline = String(formData.get("headline") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();
  const isPublic = formData.get("isPublic") === "on";

  const membership = await getMembership(orgId, user.id);
  if (!membership || membership.role === "member") {
    redirect(`/team?error=${err("Only owners and admins can update company details")}`);
  }

  let updateError: string | null = null;
  try {
    await updateOrg(orgId, {
      name: name || undefined,
      headline: headline || undefined,
      bio: bio || undefined,
      isPublic,
    });
  } catch (e) {
    updateError = e instanceof Error ? e.message : "Update failed";
  }

  if (updateError) redirect(`/team?error=${err(updateError)}`);

  revalidatePath("/team");
  redirect("/team");
}

/** Fields: orgId. Rotates the company's hfx_ key. Owner/admin only. Success → /team. */
export async function regenerateHfxKeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const orgId = String(formData.get("orgId") ?? "").trim();

  const membership = await getMembership(orgId, user.id);
  if (!membership || membership.role === "member") {
    redirect(`/team?error=${err("Only owners and admins can regenerate the HomeFAX key")}`);
  }

  let updateError: string | null = null;
  try {
    await updateOrg(orgId, { hfxKey: mintHfxKey() });
  } catch (e) {
    updateError = e instanceof Error ? e.message : "Key rotation failed";
  }

  if (updateError) redirect(`/team?error=${err(updateError)}`);

  revalidatePath("/team");
  redirect("/team");
}

/** Fields: orgId, secret (a legacy ACCESS_KEYS secret). Verifies and claims that key's records for the org. Success → /records. */
export async function claimLegacyKeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const orgId = String(formData.get("orgId") ?? "").trim();
  const secret = String(formData.get("secret") ?? "").trim();

  const membership = await getMembership(orgId, user.id);
  if (!membership || membership.role === "member") {
    redirect(`/team?error=${err("Only owners and admins can claim a legacy key")}`);
  }

  const key = verifyKey(secret);
  if (!key) {
    redirect(`/team?error=${err("That key was not recognised")}`);
  }

  let count = 0;
  let claimError: string | null = null;
  try {
    count = await claimLegacyRecords(orgId, key!.id);
  } catch (e) {
    claimError = e instanceof Error ? e.message : "Claim failed";
  }

  if (claimError) redirect(`/team?error=${err(claimError)}`);

  revalidatePath("/records");
  redirect(`/records?claimed=${count}`);
}

/** Fields: orgId. Sets the acting-company cookie. Success → back to /records. */
export async function setActiveOrgAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const orgId = String(formData.get("orgId") ?? "").trim();

  const membership = await getMembership(orgId, user.id);
  if (!membership) {
    redirect(`/records?error=${err("You are not a member of that company")}`);
  }

  const jar = await cookies();
  jar.set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });

  redirect("/records");
}

/* -------------------------------- members -------------------------------- */

/** Fields: orgId, who (email or @handle of an existing account), title (optional), role ("member"|"admin"). Owner/admin only. Success → /team. */
export async function addMemberAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const orgId = String(formData.get("orgId") ?? "").trim();
  const who = String(formData.get("who") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const role = (String(formData.get("role") ?? "member").trim()) as "member" | "admin";

  const membership = await getMembership(orgId, user.id);
  if (!membership || membership.role === "member") {
    redirect(`/team?error=${err("Only owners and admins can add members")}`);
  }

  let targetUser: Awaited<ReturnType<typeof getUserByEmail>> = null;
  if (who.startsWith("@")) {
    targetUser = await getUserByHandle(who.slice(1));
  } else {
    targetUser = await getUserByEmail(who.toLowerCase());
  }

  if (!targetUser) {
    redirect(`/team?error=${err("No account found for that email or handle")}`);
  }

  let addError: string | null = null;
  try {
    await addMembership({
      orgId,
      userId: targetUser!.id,
      role,
      title: title || undefined,
    });
  } catch (e) {
    addError = e instanceof Error ? e.message : "Failed to add member";
  }

  if (addError) redirect(`/team?error=${err(addError)}`);

  revalidatePath("/team");
  redirect("/team");
}

/** Fields: membershipId. Owner/admin only; the owner membership cannot be removed. Success → /team. */
export async function removeMemberAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const membershipId = String(formData.get("membershipId") ?? "").trim();

  const target = await getMembershipById(membershipId);
  if (!target) redirect(`/team?error=${err("Membership not found")}`);

  if (target!.role === "owner") {
    redirect(`/team?error=${err("The owner membership cannot be removed")}`);
  }

  const callerMembership = await getMembership(target!.orgId, user.id);
  if (!callerMembership || callerMembership.role === "member") {
    redirect(`/team?error=${err("Only owners and admins can remove members")}`);
  }

  let removeError: string | null = null;
  try {
    await removeMembership(membershipId);
  } catch (e) {
    removeError = e instanceof Error ? e.message : "Failed to remove member";
  }

  if (removeError) redirect(`/team?error=${err(removeError)}`);

  revalidatePath("/team");
  redirect("/team");
}

/* ------------------------- project team & access -------------------------- */

/** Fields: recordId, hfxKey. Adds the company holding that HomeFAX key to the project as collaborator. Caller needs access to the record. Success → back to the record page. */
export async function addCompanyByKeyAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const recordId = String(formData.get("recordId") ?? "").trim();
  const hfxKey = String(formData.get("hfxKey") ?? "").trim();

  const hasAccess = await canAccessRecord(user.id, recordId);
  if (!hasAccess) redirect(`/records?error=${err("You do not have access to that record")}`);

  const targetOrg = await getOrgByHfxKey(hfxKey);
  if (!targetOrg) redirect(`/records?error=${err("No company found with that HomeFAX key")}`);

  let grantError: string | null = null;
  try {
    await grantProjectAccess({
      recordId,
      orgId: targetOrg!.id,
      role: "collaborator",
      addedByUserId: user.id,
    });
  } catch (e) {
    grantError = e instanceof Error ? e.message : "Failed to add company";
  }

  if (grantError) redirect(`/records?error=${err(grantError)}`);

  const record = await getRecordById(recordId);
  revalidatePath(`/records/${record?.slug ?? ""}`);
  redirect(`/records/${record?.slug ?? ""}`);
}

/**
 * Fields: recordId, assignee ("u:<userId>" for a person, "o:<orgId>" for a
 * company), task, stage (optional StageId). Caller needs access. An assigned
 * org is also granted collaborator access so its people can open the record.
 * Success → back to the record page.
 */
export async function assignAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const recordId = String(formData.get("recordId") ?? "").trim();
  const assigneeRaw = String(formData.get("assignee") ?? "").trim();
  const task = String(formData.get("task") ?? "").trim();
  const stage = String(formData.get("stage") ?? "").trim() || undefined;

  if (!task) redirect(`/records?error=${err("Task is required")}`);

  const hasAccess = await canAccessRecord(user.id, recordId);
  if (!hasAccess) redirect(`/records?error=${err("You do not have access to that record")}`);

  let assigneeUserId: string | undefined;
  let assigneeOrgId: string | undefined;
  if (assigneeRaw.startsWith("u:")) {
    assigneeUserId = assigneeRaw.slice(2);
  } else if (assigneeRaw.startsWith("o:")) {
    assigneeOrgId = assigneeRaw.slice(2);
  } else {
    redirect(`/records?error=${err("Invalid assignee format")}`);
  }

  let assignError: string | null = null;
  try {
    await createAssignment({
      recordId,
      assigneeUserId,
      assigneeOrgId,
      task,
      stage: stage as Parameters<typeof createAssignment>[0]["stage"],
      assignedByUserId: user.id,
    });
    if (assigneeOrgId) {
      await grantProjectAccess({
        recordId,
        orgId: assigneeOrgId,
        role: "collaborator",
        addedByUserId: user.id,
      });
    }
  } catch (e) {
    assignError = e instanceof Error ? e.message : "Failed to create assignment";
  }

  if (assignError) redirect(`/records?error=${err(assignError)}`);

  const record = await getRecordById(recordId);
  revalidatePath(`/records/${record?.slug ?? ""}`);
  redirect(`/records/${record?.slug ?? ""}`);
}

/** Fields: assignmentId, status ("done"|"open"). Assignee or an org admin on the record. Success → back. */
export async function setAssignmentStatusAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const assignmentId = String(formData.get("assignmentId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim() as "done" | "open";

  const assignment = await getAssignment(assignmentId);
  if (!assignment) redirect(`/records?error=${err("Assignment not found")}`);

  // Caller is the direct assignee, or has org-level access to the record
  const isAssignee = assignment!.assigneeUserId === user.id;
  const hasAccess = isAssignee || (await canAccessRecord(user.id, assignment!.recordId));
  if (!hasAccess) redirect(`/records?error=${err("You cannot update this assignment")}`);

  let updateError: string | null = null;
  try {
    await setAssignmentStatus(assignmentId, status);
  } catch (e) {
    updateError = e instanceof Error ? e.message : "Update failed";
  }

  if (updateError) redirect(`/records?error=${err(updateError)}`);

  const record = await getRecordById(assignment!.recordId);
  revalidatePath(`/records/${record?.slug ?? ""}`);
  redirect(`/records/${record?.slug ?? ""}`);
}

/* --------------------------------- hiring --------------------------------- */

/**
 * Fields: to ("u:<userId>" | "o:<orgId>"), task, note (optional), recordId
 * (optional — ties the offer to a property). Sent from the caller's active
 * company. Success → /hire.
 */
export async function hireAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const toRaw = String(formData.get("to") ?? "").trim();
  const task = String(formData.get("task") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const recordId = String(formData.get("recordId") ?? "").trim();

  if (!task) redirect(`/hire?error=${err("Task is required")}`);

  const org = await activeOrg(user.id);
  if (!org) redirect(`/hire?error=${err("Create your company first")}`);

  let toUserId: string | undefined;
  let toOrgId: string | undefined;
  if (toRaw.startsWith("u:")) {
    toUserId = toRaw.slice(2);
  } else if (toRaw.startsWith("o:")) {
    toOrgId = toRaw.slice(2);
  } else {
    redirect(`/hire?error=${err("Invalid recipient format")}`);
  }

  let hireError: string | null = null;
  try {
    await createHire({
      fromOrgId: org!.id,
      toUserId,
      toOrgId,
      task,
      recordId: recordId || undefined,
      note: note || undefined,
      createdByUserId: user.id,
    });
  } catch (e) {
    hireError = e instanceof Error ? e.message : "Failed to send offer";
  }

  if (hireError) redirect(`/hire?error=${err(hireError)}`);

  revalidatePath("/hire");
  redirect("/hire");
}

/**
 * Fields: hireId, decision ("accept"|"decline"). Only the addressee (the
 * person, or an owner/admin of the addressed org). Accepting an offer that
 * names a property creates the assignment (and collaborator access for an
 * addressed company) so it appears on the hired side immediately.
 * Success → /hire.
 */
export async function respondHireAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const hireId = String(formData.get("hireId") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();

  const hire = await getHire(hireId);
  if (!hire) redirect(`/hire?error=${err("Offer not found")}`);

  // Verify the caller is the addressee
  let isAddressee = hire!.toUserId === user.id;
  if (!isAddressee && hire!.toOrgId) {
    const callerMembership = await getMembership(hire!.toOrgId, user.id);
    isAddressee = callerMembership !== null &&
      (callerMembership.role === "owner" || callerMembership.role === "admin");
  }
  if (!isAddressee) redirect(`/hire?error=${err("You are not the addressee of this offer")}`);

  const newStatus = decision === "accept" ? "accepted" : "declined";

  let respondError: string | null = null;
  try {
    await setHireStatus(hireId, newStatus);
    if (newStatus === "accepted" && hire!.recordId) {
      await createAssignment({
        recordId: hire!.recordId,
        assigneeUserId: hire!.toUserId ?? undefined,
        assigneeOrgId: hire!.toOrgId ?? undefined,
        task: hire!.task,
        assignedByUserId: user.id,
      });
      if (hire!.toOrgId) {
        await grantProjectAccess({
          recordId: hire!.recordId,
          orgId: hire!.toOrgId,
          role: "collaborator",
          addedByUserId: user.id,
        });
      }
    }
  } catch (e) {
    respondError = e instanceof Error ? e.message : "Failed to respond to offer";
  }

  if (respondError) redirect(`/hire?error=${err(respondError)}`);

  revalidatePath("/hire");
  redirect("/hire");
}
