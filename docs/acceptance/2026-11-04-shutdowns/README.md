# Shutdown archive integration acceptance

## Delivered behavior

- `/` defaults to eight historical whole-company shutdowns, with search and name
  sorting. It does not mix in layoffs or pivots and does not infer AI causation.
- `/shutdown/[slug]` renders all 20 source URLs and their original short quotations,
  date precision, reasons, historical scale and subsequent asset/staff transfers.
- `/impact` retains the database-backed event listing, filtering and pagination.
  Existing company pages return there; `/stats` explicitly counts impact events.
- The new archive reads the approved repository research snapshot. No production
  database was written or migrated by this integration. Existing CSV/API exports,
  admin editing and daily queue processing remain scoped to impact records.

## Local verification

- `npm run typecheck`: passed.
- `env -u DATABASE_URL npm run build`: passed on the final code, with the default
  Turbopack pipeline. No database is required to compile the application.
- `npm run verify:shutdowns`: passed, including exact source/quote preservation,
  date precision and unknown IDs. Research JSON/CSV validation also passed.
- `npm run verify:public`: 183/183 passed. Includes all eight new detail routes,
  all source URLs and quotations, unknown-slug 404, eight home records even with
  an empty database, and the existing impact filters, pagination, unpublished
  record isolation, company details and statistics.
- `PLAYWRIGHT_CHANNEL=chrome npm run verify:table`: passed at 1440 and 390 px.
  Checks horizontal/keyboard scrolling, reachable source anchors, search, sorting,
  URL persistence, refresh and empty results.
- `PLAYWRIGHT_CHANNEL=chrome npm run verify:a11y`: passed at 390 and 1280 px for
  `/`, `/shutdown/nintee`, `/shutdown/kite`, `/impact`, `/stats`, `/pricing`, and
  `/company/chegg`. This is a focused accessibility check, not a full audit.
- `git diff --check`: passed.

Screenshots were captured from the local production build and visually inspected:
[desktop](table-1440.png), [mobile](table-390.png).

The first sandboxed build failed because Turbopack could not bind its local
worker port. A retried build retained that error in generated output. After
confirming loopback binding permission and clearing `.next`, the normal build
passed; a subsequent final build passed too. No framework or dependency changes
were needed.

## Boundaries

The research snapshot's `research_only` flags describe its provenance, not a
machine-ingestion approval. The user explicitly authorized publishing this
curated archive in the application. This change does not manufacture `RecordInput`
values, precise closure dates, AI attribution, human verification or legal
dissolution claims. Future automated additions need a suitable closure evidence
contract; the existing impact queue does not update this archive.

Local UI tests used `.pglite-ui-check`; integration tests used temporary local
databases. No Vercel login or manual deployment was performed. Production
deployment and live behavior were not verified. Jev was not used.
