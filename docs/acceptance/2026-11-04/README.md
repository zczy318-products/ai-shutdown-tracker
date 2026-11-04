# Table homepage and machine ingestion verification

Verified locally on November 4, 2026. No production database was used for these checks.

## Delivered behavior

The public homepage uses a six-column table, cold white/graphite/cobalt styling,
URL-based filters and sorting, and a horizontally scrollable mobile table with a
sticky company column. Source and counterevidence links resolve to event anchors.
Human verification is shown only when the source explicitly carries that flag.

Machine ingestion stores candidates separately from published records, retrieves
and matches quotations, records machine provenance, retains existing sources,
and retries failures without a human review queue. The authenticated daily route
bootstraps the 26 historical candidates and processes a bounded batch. It does
not discover new companies independently; that provider remains unconfigured.

## Passing checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `env -u DATABASE_URL npm run build` | Passed; no build-time database access |
| `npm run verify:public` | 127/127 passed, including hidden records, empty states, filters, sources, and table structure |
| `npm run verify:db` | Constraint checks and idempotent migration passed |
| `npm run verify:pg` | PostgreSQL wire-protocol migration and constraints passed against a temporary PGlite server |
| `npm run verify:ingestion` | Candidate isolation, retries, quote/access failures, SSRF defenses, transactions, leases, fairness, and bootstrap passed |
| `npm run verify:build-gate` | Production direct-connection selection, preview isolation, missing configuration, and migration-failure refusal passed |
| `npm run verify:records` | Local admin creation, publication, rejection, archival, deletion, and authentication passed |
| `PLAYWRIGHT_CHANNEL=chrome npm run verify:a11y` | Four public routes at 390px and 1280px passed |
| `PLAYWRIGHT_CHANNEL=chrome npm run verify:table` | 1440px and 390px layout, keyboard scrolling, source anchors, URL refresh, sorting, and empty state passed |
| Research `verify.py` | Dataset structure, IDs, source URLs, and cross-file counts passed |

The browser server used `.pglite-ui-check`, seeded with 29 companies, 30 events,
and 54 source references. Screenshots `table-1440.png` and `table-390.png` show
that local dataset. No subscription email was sent.

The first manual server launch used `PGLITE_ALLOW_PRODUCTION=1`, which correctly
failed the database guard. It was corrected to `true` and the browser/admin checks
were rerun successfully. The accessibility check now rejects database error pages
instead of accidentally assessing them as the intended page.

## Activation and evidence limits

- New-company search/extraction is not configured. Daily retry is not discovery.
- Production needs `CRON_SECRET`; missing or incorrect authorization returns 401.
- The production Vercel build applies additive migration `0005_ingestion` through
  the existing `DATABASE_URL_UNPOOLED`. Local and preview builds do not migrate.
- Four historical candidates have complete proposed records. Live retrieval on
  this workstation was blocked because its proxy resolves public domains to
  reserved IP addresses. Zero live quote matches or new publications were proven.
  The SSRF guard remains intact; fixture-based tests do not replace live evidence.
- GitHub push and automatic deployment are separate from successful production
  cron execution. No production acceptance result is claimed by this document.
