import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { access, orgs, records, type AccessLogRow, type Scope } from "@homefax/db";
import { ErrorLine } from "@homefax/ui";
import {
  createShareLinkAction,
  decideRequestAction,
  dismissShareLinkAction,
  revokeGrantAction,
  revokeShareLinkAction,
} from "../actions";
import AppHeader from "@/components/AppHeader";
import { formatDay, formatWhen, plural } from "@/lib/format";
import { addressLine, openHouse } from "@/lib/house";
import { kit } from "@/lib/kit";
import { SHARE_LINK_COOKIE, parseShownShareLink } from "@/lib/share";

/**
 * The owner's control panel. Who may see the house, by which path, and every
 * look they took. Grants can be revoked, requests decided, share links made
 * and killed; the municipality's statutory view is explained, not controlled.
 */

export const dynamic = "force-dynamic";

const SCOPES: Scope[] = ["summary", "ledger", "full"];

/** A grant with no expiry, or one still ahead of us. Revoked grants never reach the page. */
function notExpired(expiresAt: Date | null): boolean {
  return !expiresAt || expiresAt.getTime() > new Date().getTime();
}

const VIA_WORD: Record<AccessLogRow["via"], string> = {
  owner: "as the owner",
  project: "as the builder",
  grant: "with your permission",
  jurisdiction: "by statute",
  share_link: "with a share link",
  service: "as the platform",
};

export default async function AccessPage({ params, searchParams }: PageProps<"/home/[slug]/access">) {
  const { slug } = await params;
  const sp = await searchParams;
  const shown = parseShownShareLink((await cookies()).get(SHARE_LINK_COOKIE)?.value);

  const data = await kit.asMe(async (tx, me) => {
    const house = await openHouse(tx, me.identity.id, slug, `/home/${slug}/access`);
    if (!house) return null;
    const pid = house.property.id;
    const [grants, requests, links, log, municipalities] = await Promise.all([
      access.listGrants(tx, pid),
      access.listRequestsForProperty(tx, pid, "pending"),
      access.listShareLinks(tx, pid),
      access.listAccessLog(tx, pid, 300),
      orgs.municipalitiesCovering(tx, house.property),
    ]);
    const orgIds = [
      ...grants.map((g) => g.granteeOrgId),
      ...requests.map((r) => r.requesterOrgId),
      ...log.map((l) => l.viewerOrgId),
      ...links.map((l) => l.createdByOrgId),
    ].filter((x): x is string => Boolean(x));
    const orgNames = await orgs.getOrgsByIds(tx, orgIds);
    const personIds = [...grants.map((g) => g.granteeIdentityId), ...log.map((l) => l.viewerIdentityId)].filter((x): x is string => Boolean(x));
    const personNames = await records.namesFor(tx, personIds);
    return { house, grants, requests, links, log, municipalities, orgNames, personNames };
  });
  if (!data) notFound();

  const { house, grants, requests, links, log, municipalities, orgNames, personNames } = data;
  const liveGrants = grants.filter((g) => notExpired(g.expiresAt));
  const liveLinks = links.filter((l) => !l.revokedAt);
  const revokedLinks = links.filter((l) => l.revokedAt);
  const linkLabel = new Map(links.map((l) => [l.id, l.label ?? `${access.SCOPE_LABEL[l.scope]} link`]));

  const whoFor = (row: AccessLogRow): string => {
    if (row.viewerOrgId) return orgNames.get(row.viewerOrgId)?.name ?? "An organisation";
    if (row.viewerIdentityId) return personNames.get(row.viewerIdentityId) ?? "Someone with access";
    if (row.shareLinkId) return `Someone with the “${linkLabel.get(row.shareLinkId) ?? "share"}” link`;
    return "Someone";
  };

  // The log, folded: one line per viewer × path × scope, with a count and the last look.
  const folded = new Map<string, { who: string; via: AccessLogRow["via"]; scope: Scope; n: number; last: Date }>();
  for (const row of log) {
    const who = whoFor(row);
    const key = `${who}|${row.via}|${row.scope}`;
    const cur = folded.get(key);
    if (cur) {
      cur.n += 1;
      if (row.at > cur.last) cur.last = row.at;
    } else folded.set(key, { who, via: row.via, scope: row.scope, n: 1, last: row.at });
  }
  const looks = [...folded.values()].sort((a, b) => b.last.getTime() - a.last.getTime());

  return (
    <>
      <AppHeader
        back={{ href: `/home/${slug}`, label: addressLine(house.property) }}
        eyebrow="Access"
        title="Who may see this record"
        subtitle="You decide. Every look anyone takes is written down here."
        meta={`${liveGrants.length + liveLinks.length} open`}
      />

      <main className="shell flex-1 space-y-6 py-5">
        <ErrorLine message={sp.error} />

        {shown && (
          <section className="plate overflow-hidden">
            <div className="px-4 pb-3 pt-4">
              <p className="eyebrow">Your new share link</p>
              <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[var(--ink-2)]">
                Copy it now — it is shown once. {shown.label ? `“${shown.label}”` : "The link"} works until you revoke it below or it expires.
              </p>
              <label className="sr-only" htmlFor="share-url">
                Share link URL
              </label>
              <input id="share-url" readOnly value={shown.url} className="input tnum mt-3 text-[0.8125rem]" onFocus={undefined} />
            </div>
            <form action={dismissShareLinkAction} className="border-t border-[var(--line)] px-4 py-3">
              <input type="hidden" name="slug" value={slug} />
              <button type="submit" className="btn btn-secondary w-full">
                I have copied it
              </button>
            </form>
          </section>
        )}

        {requests.length > 0 && (
          <section className="card overflow-hidden" style={{ borderColor: "var(--accent)" }}>
            <div className="border-b border-[var(--line)] px-4 py-3">
              <h2 className="eyebrow" style={{ color: "var(--accent)" }}>
                Waiting on you
              </h2>
            </div>
            <ul>
              {requests.map((r) => {
                const name = orgNames.get(r.requesterOrgId)?.name ?? "An organisation";
                return (
                  <li key={r.id} className="border-b border-[var(--line)] px-4 py-3.5 last:border-b-0">
                    <p className="text-[0.9375rem] font-medium leading-snug">
                      {name} is asking to see the {access.SCOPE_LABEL[r.scope].toLowerCase()}
                    </p>
                    <p className="mt-1 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{r.purpose}</p>
                    <p className="mt-1.5 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
                      {access.SCOPE_BLURB[r.scope]} Asked {formatWhen(r.createdAt)}.
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <form action={decideRequestAction}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="requestId" value={r.id} />
                        <input type="hidden" name="decision" value="approve" />
                        <button type="submit" className="btn btn-primary w-full text-[0.875rem]">
                          Approve {access.SCOPE_LABEL[r.scope].toLowerCase()}
                        </button>
                      </form>
                      {r.scope !== "summary" && (
                        <form action={decideRequestAction}>
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="requestId" value={r.id} />
                          <input type="hidden" name="decision" value="approve_summary" />
                          <button type="submit" className="btn btn-secondary w-full text-[0.875rem]">
                            Summary only
                          </button>
                        </form>
                      )}
                      <form action={decideRequestAction}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="requestId" value={r.id} />
                        <input type="hidden" name="decision" value="deny" />
                        <button type="submit" className="btn btn-secondary w-full text-[0.875rem]">
                          Deny
                        </button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="card overflow-hidden">
          <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Who you have let in</h2>
            <span className="tnum text-[0.625rem] text-[var(--ink-3)]">{liveGrants.length}</span>
          </div>
          {liveGrants.length === 0 ? (
            <p className="px-4 py-4 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              Nobody. Only you and the builder who filmed it can open this record. Institutions ask here; you decide.
            </p>
          ) : (
            <ul>
              {liveGrants.map((g) => {
                const name = g.granteeOrgId ? orgNames.get(g.granteeOrgId)?.name ?? "An organisation" : personNames.get(g.granteeIdentityId ?? "") ?? "A person";
                return (
                  <li key={g.id} className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3.5 last:border-b-0">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.9375rem] font-medium leading-snug">{name}</span>
                      {g.purpose && <span className="mt-0.5 block text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{g.purpose}</span>}
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="chip chip-accent">{access.SCOPE_LABEL[g.scope]}</span>
                        <span className="chip">since {formatDay(g.createdAt)}</span>
                        {g.expiresAt && <span className="chip">until {formatDay(g.expiresAt)}</span>}
                      </span>
                    </span>
                    <form action={revokeGrantAction} className="shrink-0">
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="grantId" value={g.id} />
                      <button type="submit" className="chip min-h-[2.75rem] px-3" style={{ color: "var(--grade-f)", borderColor: "color-mix(in oklab, var(--grade-f) 55%, transparent)" }}>
                        Revoke
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">The municipality</h2>
          </div>
          <p className="px-4 py-4 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
            {municipalities.length > 0 ? (
              <>
                <span className="font-medium text-[var(--ink)]">{municipalities.map((m) => m.name).join(" and ")}</span> can read the ledger of this house — the models, the 50-point ledger and the findings — because its jurisdiction covers {house.property.city}, {house.property.state}. That is statutory: the building inspector sees it the way they would see the house from the street, and it cannot be revoked here. Their looks are logged below like everyone else&apos;s.
              </>
            ) : (
              <>No municipality on HomeFAX covers {house.property.city}, {house.property.state} yet, so no inspector sees this record by statute. If one joins, it will be named here.</>
            )}
          </p>
        </section>

        <section className="card overflow-hidden">
          <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Share links</h2>
            <span className="tnum text-[0.625rem] text-[var(--ink-3)]">{liveLinks.length} live</span>
          </div>
          {liveLinks.length === 0 ? (
            <p className="px-4 pt-3.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              No live links. A link is a read-only copy of the record at the scope you choose — for a buyer, an inspector you hire, or an appraiser — that works without an account.
            </p>
          ) : (
            <ul>
              {liveLinks.map((l) => (
                <li key={l.id} className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.9375rem] font-medium leading-snug">{l.label ?? `${access.SCOPE_LABEL[l.scope]} link`}</span>
                    <span className="tnum mt-1 block text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                      {plural(l.viewCount, "view")}
                      {l.lastViewedAt ? ` · last ${formatWhen(l.lastViewedAt)}` : ""}
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="chip chip-accent">{access.SCOPE_LABEL[l.scope]}</span>
                      <span className="chip">{l.expiresAt ? `expires ${formatDay(l.expiresAt)}` : "never expires"}</span>
                      {l.createdByOrgId && <span className="chip">by {orgNames.get(l.createdByOrgId)?.name ?? "an organisation"}</span>}
                    </span>
                  </span>
                  <form action={revokeShareLinkAction} className="shrink-0">
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="linkId" value={l.id} />
                    <button type="submit" className="chip min-h-[2.75rem] px-3" style={{ color: "var(--grade-f)", borderColor: "color-mix(in oklab, var(--grade-f) 55%, transparent)" }}>
                      Revoke
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form action={createShareLinkAction} className="space-y-3.5 px-4 py-4">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="propertyId" value={house.property.id} />
            <p className="label">New share link</p>
            <div>
              <label className="label block" htmlFor="share-label">
                Label <span className="normal-case tracking-normal">(optional)</span>
              </label>
              <input id="share-label" name="label" placeholder="Buyer report for the Nguyens" className="input mt-1.5" />
            </div>
            <div>
              <label className="label block" htmlFor="share-scope">
                What it shows
              </label>
              <select id="share-scope" name="scope" defaultValue="summary" className="input mt-1.5">
                {SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {access.SCOPE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label block" htmlFor="share-expires">
                Lasts
              </label>
              <select id="share-expires" name="expires" defaultValue="30" className="input mt-1.5">
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="never">Until I revoke it</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary w-full">
              Create share link
            </button>
          </form>

          {revokedLinks.length > 0 && (
            <p className="border-t border-[var(--line)] px-4 py-3 text-[0.75rem] leading-relaxed text-[var(--ink-3)]">
              {plural(revokedLinks.length, "revoked link")} no longer {revokedLinks.length === 1 ? "opens" : "open"}.
            </p>
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">The three scopes</h2>
          </div>
          <dl>
            {SCOPES.map((s) => (
              <div key={s} className="border-b border-[var(--line)] px-4 py-3 last:border-b-0">
                <dt className="text-[0.875rem] font-medium">{access.SCOPE_LABEL[s]}</dt>
                <dd className="mt-0.5 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">{access.SCOPE_BLURB[s]}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card overflow-hidden">
          <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
            <h2 className="eyebrow">Every look taken</h2>
            <span className="tnum text-[0.625rem] text-[var(--ink-3)]">{log.length}</span>
          </div>
          {looks.length === 0 ? (
            <p className="px-4 py-4 text-[0.8125rem] leading-relaxed text-[var(--ink-2)]">
              Nobody but you has opened this record. Your own looks are not written down.
            </p>
          ) : (
            <ul>
              {looks.map((l) => (
                <li key={`${l.who}|${l.via}|${l.scope}`} className="border-b border-[var(--line)] px-4 py-3 last:border-b-0">
                  <p className="text-[0.875rem] leading-snug">
                    <span className="font-medium">{l.who}</span> looked at the {access.SCOPE_LABEL[l.scope].toLowerCase()} {VIA_WORD[l.via]}
                  </p>
                  <p className="tnum mt-1 text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-3)]">
                    {plural(l.n, "time")} · last {formatWhen(l.last)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
