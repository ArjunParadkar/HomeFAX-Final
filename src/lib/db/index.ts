import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * A single lazily-created connection. Next's dev server re-evaluates modules on
 * every edit, so the client is cached on globalThis to avoid leaking sockets.
 */
const globalForDb = globalThis as unknown as {
  __homefaxSql?: ReturnType<typeof postgres>;
};

export const dbConfigured = Boolean(process.env.DATABASE_URL);

function client() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Add a Postgres connection string to .env.local.",
    );
  }
  globalForDb.__homefaxSql ??= postgres(process.env.DATABASE_URL, {
    max: 5,
    idle_timeout: 20,
    prepare: false,
  });
  return globalForDb.__homefaxSql;
}

export function getDb() {
  return drizzle(client(), { schema });
}

export { schema };
