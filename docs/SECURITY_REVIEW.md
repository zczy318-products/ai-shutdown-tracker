# Pre-publication Security Review

Date: 2026-11-05. Baseline: `1db99b4`. Scope: the local changes following that
revision, all fetched Git references, publication artifacts, dependencies, and
local application behavior. The GitHub repository was verified private; this
review does not change visibility, push code, inspect a live database, or deploy.

## Findings and remediation

| Severity | Finding | Resolution |
| --- | --- | --- |
| High | Any self-registered account could read subscriber administration and mutate editorial data. | Every admin page and action now checks immutable `ADMIN_USER_IDS`. Default is no administrators; ordinary signup opens `/account`. Unverified email text never grants privileges. |
| Medium | The no-delivery mail driver logged addresses and usable confirmation/unsubscribe links. | Logs redact all message content by default. Explicit local test logging is ignored in production and on Vercel. Raw database errors are omitted from request logs. |
| Medium | Authentication had no durable attempt budget. | Atomic database counters enforce per-email and per-client limits before password hashing. Blocked clients cannot grow email counters by rotating addresses. |
| Medium | Development tooling pulled vulnerable esbuild 0.18.20 (GHSA-67mh-4wv8-2f99). | Scoped override uses esbuild 0.25.12, retaining framework/tool versions. Clean install and migration-generator checks pass; full npm audit reports zero known vulnerabilities. |
| Defense in depth | Copied connection URLs could override TLS checks; request hosts controlled subscription origins; CSV leading LF was unguarded. | Enforce verified TLS, redact invalid URL errors, validate canonical origins, and escape leading control characters. Add frame, referrer and content-type protections. |
| Product removal | Payment pages, checkout/upgrade actions, webhooks and paid gates were unnecessary. | Removed runtime payment code and configuration. Signed-in users receive free published-data CSV/API access. Existing migration history and inert database fields remain compatible. |

API-key issuance now serializes the five-key cap per owner. Ownership and
revocation remain enforced; malformed credentials are rejected before database
reads and explicitly supplied invalid keys cannot fall back to a session.

## Secret and artifact inspection

- Fetched origin before scanning. The reachable history contains 36 commits;
  Gitleaks examined 31 non-merge patches with default and project API-key rules.
  No credential findings were reported.
- Reviewed 160 tracked/eligible working-tree files through an isolated publication
  snapshot. No credential findings were reported. No real local environment file
  was present, so no claim is made about comparison with live deployment values.
- Inventoried 385 historical file blobs. OCR-checked 29 historical PNG artifacts;
  the one image with no OCR output was visually inspected (synthetic example
  address and masked password). No secret-rule findings were reported in the
  recognized text. OCR is imperfect and is not a binary-forensics guarantee.
- Removed obsolete account/payment screenshots from the current tree. Generated
  authenticated captures are ignored; capture scripts use random local fixtures,
  never capture filled password fields, and do not capture issued API keys.
- Expanded ignores for environment variants, deployment metadata and private key
  files. Added `.gitleaks.toml`, a repeatable secret command, and `SECURITY.md`.
- Existing `AGENTS.md` was preserved unchanged as instructed. Its legacy billing
  directory and `verify:saas` references are historical; current commands are in
  README and package.json.

## Verification evidence

All database writes used disposable local data. No provider was contacted to
charge a payment or send email. Verification completed:

| Check | Result |
| --- | --- |
| Clean `npm ci --ignore-scripts`, `npm audit` | Pass; zero known dependency vulnerabilities |
| `npm run typecheck`, `npm run build` | Pass |
| `npm run db:generate` | Pass; no schema changes or new migration |
| `npm run verify:security` | Pass: admin IDs, proxy trust, TLS, password corruption, redacted mail, origins, CSV injection and concurrent rate limits |
| Final local HTTP security smoke | Pass: response headers, cross-origin registration rejection, cron authentication and environment-file path denial |
| `npm run verify:auth` | 29 passed, including ordinary-user replay of a captured admin action |
| `npm run verify:account` | 32 passed: free exports, key isolation/concurrency/revocation and removed payment routes |
| `npm run verify:records` | 40 passed with an explicitly provisioned local administrator |
| `npm run verify:subscribe` | 56 passed in its own isolated app/database |
| `npm run verify:public` | 183 passed |
| `npm run verify:a11y` | Six public routes passed at mobile and desktop widths |
| `npm run verify:ingestion`, `npm run verify:shutdowns` | Pass; SSRF/publication gates and eight-company evidence archive preserved |

The first records test used an obsolete homepage path; it was corrected to
`/impact` and rerun successfully. The subscription fixture initially omitted the
shutdown JSON and retained an old logging assertion; both were corrected, the
suite passed, and test processes were cleaned up. These failures were not hidden.

## Release boundaries and remaining operator work

1. Review and approve the local changes before pushing. Repository publication
   and an open-source license remain separate decisions. No license was selected
   automatically; third-party articles and quotations retain their original rights.
2. Configure the real administrator UUID after identifying the intended account.
   Until configured, the new revision intentionally denies everyone admin access.
   Never elevate a historical demonstration account; remove any old demo accounts
   or credentials from a deployed instance through an authorized operator workflow.
3. Review historical provider logs, database backups, environment variables,
   GitHub settings and any external artifacts before public release. They were
   outside this local review. Earlier versions could log subscriber capabilities;
   if real values were logged, invalidate them and handle logs under the applicable
   retention policy. Remove obsolete payment credentials at the provider separately.
4. Use a trusted proxy and perimeter controls for public traffic. Without trusted
   client addresses, all users share the conservative unknown-IP login budget.
   CSV and JSON reads are authenticated but do not have comprehensive per-client
   traffic protection. Email delivery and email ownership verification are absent.
5. Verify the intended deployed revision after an approved push. Local passing
   tests do not establish production deployment, secret rotation, live settings,
   or an absence of every possible vulnerability.

No Jev service was used; private source and security material stayed local.

Tooling note: the installed Vercel CLI was reported outdated. Before future CLI
operations, upgrade it separately with `npm i -g vercel@latest`. This review did
not use that CLI, log into Vercel, or alter its configuration.
