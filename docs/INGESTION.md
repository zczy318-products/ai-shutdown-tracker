# Machine ingestion

Ingestion uses the existing database. The repository includes a daily retry
route and Vercel cron schedule. Discovery, email delivery, and third-party
provider configuration are separate capabilities.

## Shutdown archive boundary

The default homepage and `/shutdown/[slug]` render the explicitly approved
repository evidence snapshot through `src/lib/shutdowns.ts`. They do not read
`ai_impact` or this queue. Existing impact records now appear at `/impact`;
`/stats` and paid CSV/API exports continue to use that impact-event dataset.
A successful daily retry does not update the shutdown archive.

## Migration gate

`drizzle/0005_ingestion.sql` only adds the candidate queue, attempt audit, and daily-run lease tables.
Existing public pages do not query them. The Vercel production build applies
incremental migrations using `DATABASE_URL_UNPOOLED` before building the new
deployment. Preview and local builds do not migrate production. A missing
production migration configuration fails the build and preserves the previous
deployment. Importing
without the migration fails before retrieval or public-record writes. A GitHub
push or a successful Vercel build does not establish that migration occurred.

For a local test database:

```sh
npm run db:migrate
npm run verify:ingestion
```

The production build migration gate must succeed before enabling ingestion.
The scheduled route cannot run successfully until both the database migration
and production secret configuration are complete. Local verification uses only
temporary databases and does not migrate production from the workstation.

## Batch contract

A batch is `{ schema_version: 1, batch_id?: string, candidates: [...] }`.
Each candidate has a stable `id` (prefer a company-and-event identifier).
Research-only fields are preserved as JSON. An incomplete candidate has no
`record`; it is persisted as a retryable candidate, never as an `ai_impact`.

A publishable candidate additionally supplies:

- `record`: the camelCase `recordInputSchema` input in
  `src/lib/records/validation.ts`, including `company`, `impact`, and `sources`.
  The importer chooses publication status. Provide an explicit uncertainty or
  counter-evidence assessment and preserve the actual event date precision.
- `assessment`: `{ method: "machine", model, policyVersion, rationale,
  evidenceUrls, independenceGroups }`. `evidenceUrls` must reference record
  sources. For high confidence, at least two source URLs must map to distinct
  original evidence groups; syndicated copies share a group. A declared group
  is a machine assessment, not a deterministic proof of independence.

The importer retrieves each source afresh. It does not trust research JSON
claims about accessibility, quote matching, or human verification. Incoming
`manuallyVerified: true` is rejected. Source retrieval allows public IPv4 HTTPS
on port 443, pins the validated DNS address, revalidates redirects, and limits
response bytes and time. IPv6-only sources are deferred. Translated excerpts,
search snippets, bot-blocked responses, and unmatched quotations do not pass.

Successful attempts persist retrieval method, final URL, timestamp, HTTP status,
normalized-text hash, quote hash/offset, policy/model identity, and reasons.
Raw retrieved articles are not stored. Existing source citations and company
metadata survive later discoveries. Machine publication does not manufacture
human review stamps. Archived, rejected, or draft events are not republished
by discovery; they remain deferred for machine resolution.

## Local operation

```sh
npm run import:research -- research/path/batch.json
npm run import:research -- research/path/batch.json --write
```

The default is a dry-run: eligible records are reported as `eligible`, never
`published`, and no database is used. A dry-run with complete records still
retrieves their public sources. Only `--write` persists candidates, audit
attempts, or public records. The CLI loads `.env.local`; check the intended
database target before requesting writes.

Failed retrieval, missing data, and failed record writes are audited and become
retryable at the next UTC midnight. Explicit reimport can retry immediately. Successful
identical candidate payloads are no-ops. `dueCandidates()` returns bounded due
work for the authenticated daily route. Unattempted candidates run first, then
the least recently attempted, so repeated failures cannot starve later discoveries.
Among equally unattempted candidates, a complete `record` takes priority. Network I/O
occurs outside the short serialized write transaction. Each candidate commits
separately, so rerunning after interruption converges on the remaining work.

Historical duplicates sharing `(company slug, event date, impact type)` are
deferred as ambiguous. Date or impact-type corrections need an explicit event
identity resolution policy; changing this key is not treated as an implicit
rename. Keep daily serverless batches small enough for the configured function
duration: retrieval may take up to 15 seconds per source.

## Daily retry endpoint

`GET /api/cron/daily-update` requires `Authorization: Bearer <CRON_SECRET>`.
An absent or blank secret fails closed. The response contains counts and a UTC
day, never credentials, source bodies, or candidate payloads. It explicitly
reports `discovery: "not_configured"`: retrying an existing queue is not finding
new companies. Missing migrations return HTTP 503 without affecting the homepage.

The default budget is 40 seconds and three candidates per UTC day. Optional
`INGESTION_BUDGET_MS` (maximum 45,000) and `INGESTION_DAILY_LIMIT` (maximum 10)
bound work. A unique UTC-day lease prevents concurrent triggers, completed days
are no-ops, and expired leases can recover. Candidate slots are reserved before
retrieval; a crash consumes its reserved daily slot rather than creating an
unbounded request loop. Publication checks the lease again inside the database
transaction so an expired worker cannot publish after another worker takes over.
`vercel.json` schedules the route at `0 0 * * *` (08:00 Asia/Shanghai).
The schedule's presence is not proof of production readiness: production must
have a nonblank `CRON_SECRET`, the migration must be applied, and the candidate
queue must be populated. No new-company discovery provider is configured by
this route.

After authentication and successful lease acquisition, the route bootstraps
the 26 historical candidates from the statically imported
`research/2026-11-04-company-candidates/historical-backfill.json`. Four entries
have complete proposed records; the others remain research candidates. The
bootstrap inserts missing IDs only and never overwrites enriched payloads or
publishes directly. Every attempted complete record still requires fresh
retrieval and quote verification. Bootstrap is consumption of approved
historical research, not a new-company discovery service.
