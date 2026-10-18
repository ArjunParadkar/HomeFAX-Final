import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadEnv } from "../src/env";

/**
 * Tests run against a throw-away database created from the owner connection,
 * migrated, then used through DATABASE_APP_URL (the least-privilege role) so
 * every policy is exercised the way production exercises it.
 */
loadEnv(path.dirname(fileURLToPath(import.meta.url)));

export async function resetTestDatabase(name = "default"): Promise<void> {
  const TEST_DB = `homefax_platform_test_${name}`;
  const owner = process.env.DATABASE_URL;
  if (!owner) throw new Error("DATABASE_URL (owner) is required for db tests");
  const admin = postgres(owner, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB}' AND pid <> pg_backend_pid()`);
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }
  const testOwnerUrl = swapDb(owner, TEST_DB);
  const sql = postgres(testOwnerUrl, { max: 1, onnotice: () => {} });
  try {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      await sql.unsafe(readFileSync(path.join(dir, f), "utf8"));
    }
    await sql.unsafe(`GRANT CONNECT ON DATABASE ${TEST_DB} TO homefax_app`);
  } finally {
    await sql.end();
  }
  // Point the package client at the test database, as the app role.
  process.env.DATABASE_URL = testOwnerUrl;
  const app = process.env.DATABASE_APP_URL;
  if (app) process.env.DATABASE_APP_URL = swapDb(app, TEST_DB);
}

function swapDb(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}
