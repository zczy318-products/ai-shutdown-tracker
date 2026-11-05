# Deployment

This application can run locally with PGlite or on a Node.js host with Postgres.
The repository also includes a Vercel Git deployment configuration. Follow your
hosting provider's account permissions; publishing source code does not configure
or authorize infrastructure changes.

## Environment

Copy `.env.example` for local configuration. Keep real values in an ignored local
environment file or the hosting provider's secret store.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Runtime Postgres connection; required in production |
| `DATABASE_URL_UNPOOLED` | Direct Postgres connection for production build migrations |
| `DATABASE_SSL` | Defaults to certificate-verified TLS; disable only for a trusted local database |
| `DATABASE_POOL_MAX` | Per-process connection limit; default 1 |
| `DATABASE_IDLE_TIMEOUT_MS` | Idle connection lifetime; default 10,000 ms |
| `PGLITE_DATA_DIR` | Local embedded database directory |
| `PGLITE_ALLOW_PRODUCTION` | Local production-bundle smoke tests only; never enable on a serverless deployment |
| `NEXT_PUBLIC_APP_URL` | Canonical public origin for subscription links |
| `ADMIN_USER_IDS` | Comma-separated immutable account UUIDs with administrative access |
| `CRON_SECRET` | Server-side bearer secret for the daily retry endpoint |
| `INGESTION_DAILY_LIMIT` | Daily candidate cap; default 3, maximum 10 |
| `INGESTION_BUDGET_MS` | Retry time budget; default 40,000 ms, maximum 45,000 ms |

There is no payment configuration. Remove obsolete processor credentials from
existing hosting environments; the application does not use them. Do not put
secrets in `NEXT_PUBLIC_` variables. The public origin contains no credentials.

## First administrator

1. Deploy with no administrator UUID configured, or start locally.
2. Register a regular account and sign in to `/account`.
3. Copy the account UUID shown on that page.
4. Configure `ADMIN_USER_IDS` server-side and restart or redeploy.
5. Verify that this account can access `/admin` and a different regular account
   cannot read administrator pages or invoke administrative actions.

Never grant access based on the supplied registration email: this project does
not verify ownership of email addresses. Empty administrator configuration denies
administrative access to every account. API keys grant read-only published-data
access; they do not grant administrator privileges.

## Authentication abuse controls

Login and registration share durable limits: 10 attempts per normalized email
and 30 per client address in each 15-minute window. Unknown addresses share one
bucket. On Vercel the platform client-address header is used. On other hosts,
set `TRUST_PROXY=true` only behind a reverse proxy that strips and replaces
incoming `X-Forwarded-For`; otherwise leave it disabled. With no trusted proxy,
all clients share the conservative unknown bucket and one client can temporarily
exhaust it. Configure perimeter rate limits for public pages and bulk exports
as traffic grows; this application is not a general denial-of-service shield.

## Database and builds

For a new local installation:

```sh
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

For a local production-bundle check:

```sh
npm run typecheck
npm run build
```

A plain local build must not need production secrets or query the database while
rendering pages. Runtime database routes still need a migrated database.

`vercel.json` selects `npm run build:vercel`. Only a Vercel production build runs
the migration gate. It requires `DATABASE_URL_UNPOOLED`, uses one direct connection
and an advisory lock, then runs the application build. A missing configuration or
migration failure fails the build. Preview and local builds skip production
migrations. Keep migrations compatible with the preceding deployment because
successful DDL may remain applied if the later application build fails.

Preserve applied migrations. Historical plan enums, user processor-ID fields,
and `billing_events` are inert compatibility data, not active payment features.
No destructive billing-table migration is needed to remove payment behavior.

## Data and scheduling

The default shutdown archive is statically imported from the research JSON and
ships with the source. It does not require converting uncertain closure dates
into impact records. `/impact`, account features, exports and API keys use the
runtime database.

`GET /api/cron/daily-update` requires a nonblank `CRON_SECRET`. Vercel's schedule
is `0 0 * * *` (08:00 Asia/Shanghai). Configure the secret and apply the ingestion
migration before expecting successful runs. Missing configuration fails closed.
The endpoint inserts missing historical candidate IDs only, verifies source
access and original quotations before publication, and records failures for
retry. It does not discover new companies. See [ingestion operations](docs/INGESTION.md).

The seed command writes published impact fixtures. Choose the target database
explicitly before invoking it; a successful deployment does not prove that any
seed or backfill was imported. Never test account-creation or record-write flows
against an unrelated production database.

## Acceptance

Use [the current acceptance checks](docs/ACCEPTANCE.md). Reopen the intended
runtime target after a release and verify public reading, regular-account free
CSV/API access, revocation, admin isolation, and cron authentication separately.
A green build alone is not evidence of those runtime behaviors.

No email provider is installed. Subscription registration must report that no
message was delivered. Keep recipient data, token-bearing links, session cookies,
API key plaintext, and private exports out of logs and public artifacts.
