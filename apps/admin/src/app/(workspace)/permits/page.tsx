import Link from "next/link";
import { ErrorLine } from "@homefax/ui";
import { oversight, records, type BuildRecord } from "@homefax/db";
import { createPermitAction, updatePermitAction } from "@/app/(workspace)/permits/actions";
import { PERMIT_TONE, StatusWord } from "@/components/bits";
import PageTitle from "@/components/PageTitle";
import Panel, { Empty } from "@/components/Panel";
import PropertyPicker from "@/components/PropertyPicker";
import { date, plural, titleWord, todayIso } from "@/lib/format";
import { asWorkspace, requireKind } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const KINDS = ["building", "electrical", "plumbing", "mechanical", "roofing", "demolition", "other"] as const;
const STATUSES = ["applied", "issued", "inspected", "closed", "flagged", "revoked"] as const;

/** The permit register: list, create, change status, link to a build record. */
export default async function PermitsPage({ searchParams }: PageProps<"/permits">) {
  await requireKind("municipality");
  const sp = await searchParams;
  const data = await asWorkspace(async (tx, ws) => {
    const permits = await oversight.listPermits(tx, ws.org.id);
    const jur = await oversight.listJurisdictionProperties(tx, ws.org.id);
    const recordsByProperty = new Map<string, BuildRecord[]>();
    for (const p of permits) if (!recordsByProperty.has(p.property.id)) recordsByProperty.set(p.property.id, await records.listRecordsForProperty(tx, p.property.id));
    return { permits, jur, recordsByProperty };
  });
  const open = data.permits.filter((p) => !["closed", "revoked"].includes(p.row.status)).length;

  return (
    <>
      <PageTitle eyebrow="Permits" title="Permit register" subtitle="Permits this municipality has taken in, issued, inspected, and closed. Linking one to a build record lets reviews cite it." />
      <ErrorLine message={sp.error} className="mb-4" />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Permits" meta={`${open} open · ${plural(data.permits.length, "permit")}`} flush>
          {data.permits.length === 0 ? (
            <Empty>No permits on the register yet. Add the first one on the right.</Empty>
          ) : (
            <div className="ledger-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>Permit</th>
                    <th>House</th>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Applied</th>
                    <th>Issued</th>
                    <th>Record</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.permits.map((p) => {
                    const recs = data.recordsByProperty.get(p.property.id) ?? [];
                    return (
                      <tr key={p.row.id}>
                        <td className="mono font-medium">{p.row.permitNo}</td>
                        <td>
                          <Link href={`/properties/${p.property.slug}?tab=permits`}>{p.property.line1}</Link>
                        </td>
                        <td>{titleWord(p.row.kind)}</td>
                        <td>
                          <StatusWord tone={PERMIT_TONE[p.row.status]}>{titleWord(p.row.status)}</StatusWord>
                        </td>
                        <td className="mono">{date(p.row.appliedAt)}</td>
                        <td className="mono">{date(p.row.issuedAt)}</td>
                        <td className="text-[var(--ink-2)]">{p.row.recordId ? recs.find((r) => r.id === p.row.recordId)?.contractorName ?? "Linked" : "—"}</td>
                        <td className="num">
                          <form action={updatePermitAction} className="flex justify-end gap-1.5">
                            <input type="hidden" name="permitId" value={p.row.id} />
                            {recs.length > 0 && (
                              <select name="recordId" defaultValue={p.row.recordId ?? ""} className="input input-sm select w-auto" aria-label="Build record">
                                <option value="">No record</option>
                                {recs.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.contractorName ?? r.slug} · {r.status}
                                  </option>
                                ))}
                              </select>
                            )}
                            <select name="status" defaultValue={p.row.status} className="input input-sm select w-auto" aria-label="New status">
                              {STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {titleWord(s)}
                                </option>
                              ))}
                            </select>
                            <button type="submit" className="btn btn-secondary btn-sm">
                              Set
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Add a permit">
          <form action={createPermitAction} className="space-y-4">
            <PropertyPicker properties={data.jur.map((r) => r.property)} label="Property in jurisdiction" />
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label block" htmlFor="permitNo">
                  Permit number
                </label>
                <input id="permitNo" name="permitNo" required placeholder="BP-2026-01500" className="input input-sm tnum mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="kind">
                  Kind
                </label>
                <select id="kind" name="kind" required defaultValue="building" className="input input-sm select mt-1.5">
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {titleWord(k)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label block" htmlFor="status">
                  Status
                </label>
                <select id="status" name="status" defaultValue="applied" className="input input-sm select mt-1.5">
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {titleWord(s)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label block" htmlFor="appliedAt">
                  Applied on
                </label>
                <input id="appliedAt" name="appliedAt" type="date" defaultValue={todayIso()} className="input input-sm tnum mt-1.5" />
              </div>
              <div>
                <label className="label block" htmlFor="issuedAt">
                  Issued on <span className="normal-case tracking-normal">(if issued)</span>
                </label>
                <input id="issuedAt" name="issuedAt" type="date" className="input input-sm tnum mt-1.5" />
              </div>
            </div>
            <div>
              <label className="label block" htmlFor="notes">
                Notes
              </label>
              <textarea id="notes" name="notes" rows={2} className="input input-sm mt-1.5" />
            </div>
            <p className="text-[0.75rem] leading-relaxed text-[var(--ink-3)]">Link the permit to the builder&apos;s record from the register once it is in; the list of records appears per house.</p>
            <button type="submit" className="btn btn-primary btn-sm">
              Add the permit
            </button>
          </form>
        </Panel>
      </div>
    </>
  );
}
