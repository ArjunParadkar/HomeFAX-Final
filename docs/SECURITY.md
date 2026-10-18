# Security model

What protects a HomeFAX record, layer by layer, and what each layer does **not**
cover. Written so the next engineer can tell a real gap from a design choice.

## Assets

1. The house record: models, grades, ledger, findings, materials, documents.
2. Who may see it: grants, share links, jurisdictions, the access log.
3. Institutional data: loans, policies, listings, permits, inspection verdicts.
4. People: email, password hash, phone, sessions.

## Layers

| Layer | Mechanism | Covers | Does not cover |
|---|---|---|---|
| Transport | HTTPS on Vercel; `secure` + `httpOnly` + `SameSite=Lax` cookies | token theft in transit, XSS reading the cookie | a compromised device |
| Authentication | scrypt (N=32768, per-password salt, NFKC-normalised); 10-char minimum + breach-list check; opaque 256-bit session tokens stored as SHA-256; per-app sessions with sliding (14d) and absolute (60d) expiry; sign-in throttled per email (5/15 min) and per IP (20/15 min) | credential stuffing, offline cracking of a leaked table, replay of an old cookie | phishing; no MFA yet (add TOTP as an `auth.factors` table — the session model already supports it) |
| Authorisation | Postgres row-level security, **forced** on every table, keyed on transaction-local settings (`app.actor_id`, `app.role`, `app.share_hash`); one function `app.property_scope()` is the single rule for who sees a house | a forgotten `where` in TypeScript, a new page that reads too much, a compromised app role reading across tenants | a bug *inside* a policy (covered by `packages/db/tests/access.test.ts`, the matrix — extend it when adding a path) |
| Least privilege | `homefax_app` runtime role: no DDL, no BYPASSRLS, SELECT/INSERT only on the audit log; owner role used only by migrations/scripts | schema tampering or policy changes from a compromised app | a leaked owner connection string |
| Service path | `withService` is the only way to read credentials, resolve a share token, or create a property; each use is named in the repos' doc comments | accidental privilege use (it is loud and greppable) | a developer calling it where they should not — review for it |
| Data minimisation | credentials in their own table; profiles public-flagged; `toPublicProfile`/`toPublicOrg` strip private fields; identities tombstoned on erasure | a page accidentally rendering an email | — |
| Encryption at rest | AES-256-GCM (app side, versioned ciphertext) for phone numbers and loan/policy references; Neon encrypts the volume | a database dump exposing those fields | the key in the app's environment |
| Accountability | append-only audit log (trigger-fed, secrets redacted, UPDATE/DELETE raise) on identities, credentials, orgs, memberships, properties, owners, grants, requests, share links, institutional rows; `access.access_log` for every non-owner look at a house, readable by the owner | silent tampering, "who saw my house" | log volume — prune `login_attempts`, export the audit log monthly |
| Share links | 192-bit tokens, hashed at rest, scoped, expiring, revocable, view-counted; resolved as the service then rendered under the link's scope | link reuse after revocation; a link escalating scope | a link being forwarded (by design — the owner chose to share) |

## Things to keep true

- Every new table gets `ENABLE` **and** `FORCE ROW LEVEL SECURITY` and at least one
  policy before it gets a GRANT. Add it to the matrix test.
- Never add a column named like a secret without adding it to the redaction list
  in `audit.log_change()`.
- `RETURNING` re-checks the SELECT policy: writers with less scope than the row
  must not use it (see `properties.addEvent`).
- The apps never read `DATABASE_URL` in production once `DATABASE_APP_URL` is set.
- Rotate: `PII_ENCRYPTION_KEY` (bump the ciphertext version), the app-role
  password (`create-app-role`), the Blob token. Sessions need no rotation — revoke.

## Reporting

Security issues: open a private GitHub security advisory on the repository.
