import { sql, type ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle, type PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type { PgTransaction } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * One pool, cached on globalThis so Next's dev reloads do not leak sockets.
 *
 * DATABASE_APP_URL is the least-privilege role (homefax_app). When only
 * DATABASE_URL is present we connect as the owner — every table carries
 * FORCE ROW LEVEL SECURITY, so the policies still bind.
 */
const g = globalThis as unknown as { __hfxSql?: ReturnType<typeof postgres> };

export const dbConfigured = Boolean(process.env.DATABASE_APP_URL ?? process.env.DATABASE_URL);

function pool() {
  const url = process.env.DATABASE_APP_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  g.__hfxSql ??= postgres(url, {
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => {},
  });
  return g.__hfxSql;
}

export function rawDb() {
  return drizzle(pool(), { schema });
}

export type Tx = PgTransaction<PostgresJsQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

/** Who is asking. Everything the policies know about the caller. */
export type Actor = {
  /** The signed-in identity, or null for an anonymous visitor. */
  identityId: string | null;
  /** SHA-256 of a share-link token presented with the request, if any. */
  shareHash?: string | null;
};

export const ANONYMOUS: Actor = { identityId: null };

type Settings = { actorId: string; role: string; shareHash: string };

async function inTransaction<T>(settings: Settings, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return rawDb().transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.actor_id', ${settings.actorId}, true),
                 set_config('app.role', ${settings.role}, true),
                 set_config('app.share_hash', ${settings.shareHash}, true)`,
    );
    return fn(tx);
  });
}

/** Run as a person (or anonymous visitor). Row-level security decides what they see. */
export function withActor<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction(
    { actorId: actor.identityId ?? "", role: "", shareHash: actor.shareHash ?? "" },
    fn,
  );
}

/**
 * Run as the platform itself: sign-in, sign-up, the reconstruction pipeline,
 * imports. Policies open up, so every caller must have checked authorization
 * before reaching for this — it is the one escape hatch and it is named loudly.
 */
export function withService<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return inTransaction({ actorId: "", role: "service", shareHash: "" }, fn);
}

/** Current scope on a property for the running transaction's actor. */
export async function scopeOf(tx: Tx, propertyId: string): Promise<schema.Scope | null> {
  const rows = await tx.execute<{ scope: string | null }>(sql`SELECT app.property_scope(${propertyId}) AS scope`);
  return (rows[0]?.scope as schema.Scope | null) ?? null;
}

export async function canBuild(tx: Tx, propertyId: string): Promise<boolean> {
  const rows = await tx.execute<{ ok: boolean }>(sql`SELECT app.can_build(${propertyId}) AS ok`);
  return Boolean(rows[0]?.ok);
}

export async function closePool(): Promise<void> {
  await g.__hfxSql?.end();
  g.__hfxSql = undefined;
}

export { schema };
