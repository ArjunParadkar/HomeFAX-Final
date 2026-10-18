# HomeFAX monorepo

npm workspaces. `apps/contractor`, `apps/homeowner`, `apps/admin` are Next.js 16 apps;
`packages/core` (domain), `packages/ui` (design system), `packages/db` (schema, RLS,
repositories), `packages/auth` (crypto primitives) are shared TypeScript source compiled by
each app via `transpilePackages`.

Read `docs/ARCHITECTURE.md` first, then `docs/DATABASE.md` before touching the schema.
Next.js 16 differs from older versions — see `apps/contractor/AGENTS.md`.
