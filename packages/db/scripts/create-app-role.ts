/**
 * Give the least-privilege runtime role a password so apps can connect as it.
 *
 *   DATABASE_URL=<owner url> APP_ROLE_PASSWORD=<secret> npx tsx scripts/create-app-role.ts
 *
 * Then set DATABASE_APP_URL for the apps to postgres://homefax_app:<secret>@host/db.
 * The role is created NOLOGIN by migration 0001; this only flips LOGIN and sets the password.
 */
import postgres from "postgres";
import { loadEnv } from "../src/env";

loadEnv();
const url = process.env.DATABASE_URL;
const pw = process.env.APP_ROLE_PASSWORD;
if (!url || !pw) {
  console.error("DATABASE_URL and APP_ROLE_PASSWORD are required");
  process.exit(1);
}
const sql = postgres(url, { max: 1 });
try {
  // Password is interpolated as a literal: postgres.js cannot parameterise DDL.
  await sql.unsafe(`ALTER ROLE homefax_app LOGIN PASSWORD '${pw.replace(/'/g, "''")}'`);
  const [db] = await sql`SELECT current_database() AS db`;
  await sql.unsafe(`GRANT CONNECT ON DATABASE "${db.db}" TO homefax_app`);
  console.log("homefax_app can now log in");
} finally {
  await sql.end();
}
