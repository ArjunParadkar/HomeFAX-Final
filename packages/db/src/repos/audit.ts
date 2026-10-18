import { and, desc, eq, lt } from "drizzle-orm";
import type { Tx } from "../client";
import { auditLog, type AuditRow } from "../schema/audit";

/** Change history. RLS limits rows to the actor's own actions, their orgs' rows (admins), and their houses (owners). */
export async function listAuditForOrg(tx: Tx, orgId: string, limit = 100, before?: Date): Promise<AuditRow[]> {
  return tx
    .select()
    .from(auditLog)
    .where(before ? and(eq(auditLog.orgId, orgId), lt(auditLog.at, before)) : eq(auditLog.orgId, orgId))
    .orderBy(desc(auditLog.at))
    .limit(limit);
}
export async function listAuditForProperty(tx: Tx, propertyId: string, limit = 100): Promise<AuditRow[]> {
  return tx.select().from(auditLog).where(eq(auditLog.propertyId, propertyId)).orderBy(desc(auditLog.at)).limit(limit);
}
export async function listAuditForActor(tx: Tx, actorId: string, limit = 100): Promise<AuditRow[]> {
  return tx.select().from(auditLog).where(eq(auditLog.actorId, actorId)).orderBy(desc(auditLog.at)).limit(limit);
}

/** A one-line, human reading of an audit row. */
export function describeAudit(row: AuditRow): string {
  const verb = row.action === "INSERT" ? "created" : row.action === "UPDATE" ? "changed" : "removed";
  const what = `${row.schemaName}.${row.tableName}`.replace(/_/g, " ");
  if (row.action === "UPDATE" && row.before && row.after) {
    const changed = Object.keys(row.after).filter((k) => JSON.stringify(row.after![k]) !== JSON.stringify(row.before![k]) && k !== "updated_at");
    if (changed.length) return `${verb} ${what} (${changed.join(", ")})`;
  }
  return `${verb} ${what}`;
}
