import Link from "next/link";
import { ErrorLine } from "@homefax/ui";
import { access, orgs, withService } from "@homefax/db";
import { withdrawRequestAction } from "@/app/(workspace)/properties/actions";
import { REQUEST_TONE, StatusWord } from "@/components/bits";
import PageTitle from "@/components/PageTitle";
import Panel, { Empty } from "@/components/Panel";
import { cityOf, date, streetOf, titleWord } from "@/lib/format";
import { asWorkspace, requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

/** The institution's requests for access and what became of them. */
export default async function RequestsPage({ searchParams }: PageProps<"/requests">) {
  const sp = await searchParams;
  const ws = await requireWorkspace();
  // Houses the institution can already see get a link; the rest are addresses only.
  const visible = new Set((await asWorkspace((tx) => access.listRequestsForOrg(tx, ws.org.id))).map((r) => r.property.id));
  // A pending request is on a house the actor cannot see yet, so the list runs
  // as the service — after confirming membership of the requesting institution
  // under RLS, which is what requireWorkspace did via the memberships table.
  const member = await asWorkspace((tx) => orgs.getMembership(tx, ws.org.id, ws.me.identity.id));
  const rows = member ? await withService((tx) => access.listRequestsForOrgAsService(tx, ws.org.id)) : [];
  const pending = rows.filter((r) => r.request.status === "pending");
  const decided = rows.filter((r) => r.request.status !== "pending");

  return (
    <>
      <PageTitle eyebrow="Requests" title="Access requests" subtitle="What this institution has asked owners for. Approved requests become grants and the house appears on the board." actions={<Link href="/properties#request" className="btn btn-primary btn-sm">Request access</Link>} />
      <ErrorLine message={sp.error} className="mb-4" />
      {sp.ok === "requested" && <p className="mb-4 text-[0.8125rem] text-[var(--grade-a)]">Request sent. The owner sees it on their house and decides.</p>}

      <Panel title="Pending" meta={`${pending.length}`} flush className="mb-5">
        {pending.length === 0 ? (
          <Empty>Nothing pending. Request access from the Properties page.</Empty>
        ) : (
          <Table rows={pending} visible={visible} withdraw />
        )}
      </Panel>
      <Panel title="Decided" meta={`${decided.length}`} flush>
        {decided.length === 0 ? <Empty>No decisions yet.</Empty> : <Table rows={decided} visible={visible} />}
      </Panel>
    </>
  );
}

function Table({ rows, visible, withdraw = false }: { rows: access.RequestWithAddress[]; visible: Set<string>; withdraw?: boolean }) {
  return (
    <div className="ledger-wrap">
      <table className="ledger">
        <thead>
          <tr>
            <th>Address</th>
            <th>Scope</th>
            <th>Purpose</th>
            <th>Status</th>
            <th>Asked</th>
            <th>Decided</th>
            {withdraw && <th></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ request: r, address: p }) => (
            <tr key={r.id}>
              <td>
                {visible.has(p.id) ? (
                  <Link href={`/properties/${p.slug}`} className="block font-medium">
                    {streetOf(p)}
                  </Link>
                ) : (
                  <span className="block font-medium">{streetOf(p)}</span>
                )}
                <span className="text-[0.6875rem] text-[var(--ink-3)]">{cityOf(p)}</span>
              </td>
              <td>{access.SCOPE_LABEL[r.scope]}</td>
              <td className="max-w-[28rem] text-[var(--ink-2)]">{r.purpose}</td>
              <td>
                <StatusWord tone={REQUEST_TONE[r.status]}>{titleWord(r.status)}</StatusWord>
              </td>
              <td className="mono">{date(r.createdAt)}</td>
              <td className="mono">{date(r.decidedAt)}</td>
              {withdraw && (
                <td className="num">
                  <form action={withdrawRequestAction}>
                    <input type="hidden" name="requestId" value={r.id} />
                    <button type="submit" className="btn btn-secondary btn-sm">
                      Withdraw
                    </button>
                  </form>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
