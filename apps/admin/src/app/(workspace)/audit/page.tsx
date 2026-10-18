import Link from "next/link";
import { access, audit, orgs, properties } from "@homefax/db";
import PageTitle from "@/components/PageTitle";
import Panel, { Empty } from "@/components/Panel";
import { dateTime, streetOf, titleWord } from "@/lib/format";
import { asWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/**
 * Institutions are accountable too: the change history the audit trigger kept
 * for this organisation, and every look its members took at a house. Both are
 * RLS-limited to admins of the institution; members see their own rows.
 */
export default async function AuditPage() {
  const data = await asWorkspace(async (tx, ws) => {
    const changes = await audit.listAuditForOrg(tx, ws.org.id, 150);
    const looks = await access.listAccessLogForOrg(tx, ws.org.id, 200);
    const ids = [...new Set([...changes.map((c) => c.actorId), ...looks.map((l) => l.viewerIdentityId)].filter((x): x is string => Boolean(x)))];
    const names = await orgs.getProfilesByIds(tx, ids);
    const houses = await properties.getPropertiesWithStats(tx, [...new Set([...looks.map((l) => l.propertyId), ...changes.map((c) => c.propertyId).filter((x): x is string => Boolean(x))])]);
    return { ws, changes, looks, names, houses: new Map(houses.map((h) => [h.property.id, h.property])) };
  });

  const who = (id: string | null) => (id ? (data.names.get(id)?.name ?? "A member") : "The platform");

  return (
    <>
      <PageTitle eyebrow="Audit" title="What this institution did" subtitle={data.ws.isAdmin ? "Every change made under this institution and every look its members took at a house. Append-only; secrets redacted." : "You see your own actions and your own looks. Owners and admins see the whole institution's."} />

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Looks at houses" meta={`${data.looks.length}`} flush>
          {data.looks.length === 0 ? (
            <Empty>No member of this institution has opened a house yet.</Empty>
          ) : (
            <div className="ledger-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>House</th>
                    <th>Via</th>
                    <th>Scope</th>
                    <th>Where</th>
                  </tr>
                </thead>
                <tbody>
                  {data.looks.map((l) => {
                    const h = data.houses.get(l.propertyId);
                    return (
                      <tr key={l.id}>
                        <td className="mono whitespace-nowrap">{dateTime(l.at)}</td>
                        <td>{who(l.viewerIdentityId)}</td>
                        <td>{h ? <Link href={`/properties/${h.slug}`}>{streetOf(h)}</Link> : <span className="text-[var(--ink-3)]">A house no longer in view</span>}</td>
                        <td>{titleWord(l.via)}</td>
                        <td>{access.SCOPE_LABEL[l.scope]}</td>
                        <td className="mono text-[0.6875rem] text-[var(--ink-3)]">
                          {l.app}
                          {l.path ? ` ${l.path}` : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Changes" meta={`${data.changes.length}`} flush>
          {data.changes.length === 0 ? (
            <Empty>No changes recorded against this institution yet.</Empty>
          ) : (
            <div className="ledger-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>What</th>
                    <th>House</th>
                  </tr>
                </thead>
                <tbody>
                  {data.changes.map((c) => {
                    const h = c.propertyId ? data.houses.get(c.propertyId) : null;
                    return (
                      <tr key={c.id}>
                        <td className="mono whitespace-nowrap">{dateTime(c.at)}</td>
                        <td>{c.isService ? "The platform" : who(c.actorId)}</td>
                        <td>{audit.describeAudit(c)}</td>
                        <td>{h ? <Link href={`/properties/${h.slug}`}>{streetOf(h)}</Link> : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
