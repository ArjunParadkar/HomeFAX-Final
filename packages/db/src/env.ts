import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Minimal .env loader for scripts and tests (Next loads env itself; tsx does
 * not). Looks for .env.local then .env in the package and the repo root.
 * Never overrides a variable already in the environment.
 */
export function loadEnv(startDir = process.cwd()): void {
  const candidates: string[] = [];
  let dir = startDir;
  for (let i = 0; i < 4; i++) {
    candidates.push(path.join(dir, ".env.local"), path.join(dir, ".env"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}
