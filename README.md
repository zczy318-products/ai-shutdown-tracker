# Rest In Prompts

A source-backed archive of AI-related company shutdowns and reported business
impacts. The interface uses Simplified Chinese. An AI-related business closing
is not evidence that AI competition caused its closure.

The default homepage reads eight historical shutdown files from
`research/2026-11-04-confirmed-shutdowns/companies.json`. Each entry preserves
closure-date precision, original quotations, later asset transfers, and unknowns.
The independent database-backed impact archive lives at `/impact` and `/stats`.
See [shutdown criteria](docs/SHUTDOWN_CRITERIA.md).

All public reading is anonymous. Every signed-in account can export the published
impact dataset and create owner-scoped API keys for free. There are no payment
pages, checkout actions, subscription tiers, or payment webhooks. CSV/API access
does not currently include the separate shutdown archive.

## Local development

Use Node.js 22 or later and npm. No external database or provider is needed for
local development; PGlite runs an embedded Postgres database.

```sh
npm ci
cp .env.example .env.local
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3000`. Self-registration creates a regular account and
opens `/account`. Registration does not grant editorial or subscriber access.
Keep real credentials and private exports out of version control.

To administer your own instance, copy your account UUID from `/account` into the
server-side `ADMIN_USER_IDS` environment variable and restart the server. Multiple
IDs are comma-separated. Email addresses are not verified and are never an
administrator identity. With no configured UUIDs, no account has admin access.

## Routes

| Route | Access and scope |
| --- | --- |
| `/`, `/shutdown/[slug]` | Public historical shutdown archive |
| `/impact`, `/company/[slug]`, `/stats` | Public published impact events |
| `/register`, `/login` | Regular account authentication |
| `/account` | Own UUID, free CSV download, own API keys, logout |
| `/api/export/records` | Free published impact CSV using a session or API key |
| `/api/v1/records` | Read-only published impact JSON using an API key |
| `/admin/*` | Explicitly configured administrators only |
| `/subscribe/*` | Anonymous email registration and token-based lifecycle |
| `/api/cron/daily-update` | Secret-authenticated retry of the historical queue |

For CSV, anonymous browser requests redirect to `/login`; scripts receive HTTP
401 JSON. Invalid or revoked API keys receive HTTP 401 even if a valid session
cookie is also present. JSON API authentication uses `Authorization: Bearer`
or `X-API-Key`. API keys are shown once, stored as SHA-256 digests, and revoked
by their owner. Every account can hold at most five active keys.

The JSON API accepts `limit` (1–500) and `offset`; only `GET` is supported. CSV
contains one row per source and includes evidence attribution and verbatim quotes.
Never omit those evidence qualifiers when reusing the data.

## Structure

- `src/app/`: routes, server actions, account and administrator pages.
- `src/lib/`: authentication, authorization, validation, exports, and ingestion.
- `src/db/` and `drizzle/`: shared Postgres/PGlite schema and additive migrations.
- `seed/`: source-backed impact-event fixtures.
- `research/`: historical research and shutdown evidence.
- `scripts/`: integration and browser verification.

The stack is Next.js App Router, React, strict TypeScript, Tailwind CSS and
Drizzle ORM. Use npm rather than pnpm. New code and technical documentation use
English; user-facing pages use Simplified Chinese.

## Verification

```sh
npm run typecheck
npm run build
npm run verify:security
npm run verify:shutdowns
npm run verify:db
npm run verify:pg
npm run verify:ingestion
npm run verify:build-gate
npm run verify:public
```

Against a running **local** server with seeded data:

```sh
npm run verify:auth
npm run verify:records
npm run verify:account
npm run verify:a11y
npm run verify:table
```

`verify:account` creates temporary regular accounts and checks free export,
key creation/use/revocation, cross-account isolation, and removed payment routes.
Use local databases for checks that create accounts or records. Authenticated
administrator checks require the explicitly configured test administrator.
See [acceptance checks](docs/ACCEPTANCE.md) and [deployment](DEPLOY.md).

## Operations and compatibility

Production requires `DATABASE_URL`. Vercel production builds apply migrations
through the direct `DATABASE_URL_UNPOOLED` connection; preview and local builds
do not run that production migration gate. Database configuration and canonical
origin examples are in `.env.example`.

Daily retries use the existing database, a nonblank `CRON_SECRET`, and a bounded
UTC-day lease. They bootstrap the approved historical candidate batch without
overwriting enriched records. New-company discovery is not configured. See
[ingestion operations](docs/INGESTION.md).

Email registration is independent of accounts. No delivery provider is installed;
registration must not claim a message was delivered. Tokens and recipient data
must not be printed in production logs.

Applied migrations remain immutable. Legacy `users.plan`, historical plan-source
and processor-ID columns, and `billing_events` remain in the schema solely so
existing installations migrate safely. They are inert: no runtime payment
handler, paid entitlement, or plan mutation remains. Do not recreate these
features from old schema names or historical migration SQL.

## Security and release preparation

See [security guidance](SECURITY.md) and the [pre-release review](docs/SECURITY_REVIEW.md).
Run `npm run security:secrets` with Gitleaks installed and `npm audit` before publishing.
The secret check includes all locally fetched Git references; fetch remote branches first.
