/**
 * Apply every migrations/*.sql not yet recorded in public.hfx_migrations, each
 * in its own transaction, in filename order. Idempotent and safe to re-run.
 *
 *   DATABASE_URL=postgres://… npx tsx scripts/migrate.ts [--dry-run]
 *
 * Uses the OWNER connection (it creates schemas, roles, policies). The runtime
 * apps never need this privilege.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { loadEnv } from "../src/env";

loadEnv();
const dry = process.argv.includes("--dry-run");
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

async function main() {
  await sql`CREATE TABLE IF NOT EXISTS public.hfx_migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  const applied = new Map<string, string>(
    (await sql<{ name: string; checksum: string }[]>`SELECT name, checksum FROM public.hfx_migrations`).map((r) => [r.name, r.checksum]),
  );
  let ran = 0;
  for (const f of files) {
    const body = readFileSync(path.join(dir, f), "utf8");
    const checksum = createHash("sha256").update(body).digest("hex");
    const prior = applied.get(f);
    if (prior) {
      if (prior !== checksum) {
        console.error(`✗ ${f} was applied with a different checksum — migrations are immutable; add a new file instead`);
        process.exit(2);
      }
      continue;
    }
    if (dry) {
      console.log(`would apply ${f}`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO public.hfx_migrations (name, checksum) VALUES (${f}, ${checksum})`;
    });
    console.log(`✓ ${f}`);
    ran++;
  }
  console.log(ran === 0 ? "database is up to date" : `applied ${ran} migration${ran === 1 ? "" : "s"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => sql.end());
