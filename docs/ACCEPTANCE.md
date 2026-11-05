# Acceptance checks

This document describes the current free application. Historical screenshots or
reports are not proof that the current revision passed. Record the tested commit,
local target, actual commands and failures when publishing verification results.

## Public data

- `/` shows the source-backed shutdown archive without login.
- Unknown closure dates remain unknown; announcement dates remain separate.
- `/shutdown/[slug]` preserves source links, original quotes and uncertainty.
- `/impact`, impact details and `/stats` expose only published impact records.
- Empty data and database failures render different states.
- Filters, sorting and pagination survive refresh and shared URLs.

## Accounts and API

Run against a local server with a temporary or disposable seeded database:

```sh
npm run verify:account
```

The check creates regular accounts and proves:

- Anonymous reading works; account pages require a session.
- Anonymous CSV navigation goes to login and scripts receive HTTP 401.
- A newly registered regular account can download CSV immediately for free.
- CSV keeps its BOM, source columns, attribution qualifiers and evidence.
- An account can issue and use its own API key without an upgrade.
- Another account cannot list or revoke that key.
- Revocation immediately rejects both JSON and CSV requests.
- API writes are rejected and removed payment routes return not found.

API key plaintext appears only after issuance. Never publish token-bearing
screenshots, session cookies or full private exports as acceptance artifacts.

## Administration

Configure test administrator UUIDs through `ADMIN_USER_IDS`. Verify a regular
account cannot access `/admin/*`, read subscriber records or execute editorial
actions; both page reads and server actions need administrative authorization.
An allowlisted administrator can edit and publish records subject to evidence
gates. Email address text is not proof of administrator identity.

## Focused commands

```sh
npm run typecheck
npm run build
npm run verify:shutdowns
npm run verify:db
npm run verify:pg
npm run verify:public
npm run verify:ingestion
npm run verify:build-gate
```

Against the appropriate running local test server:

```sh
npm run verify:auth
npm run verify:records
npm run verify:a11y
npm run verify:table
```

`verify:subscribe` uses disposable data to verify token lifecycle and no-delivery
behavior. Browser checks require Playwright Chromium and suitable fonts. Optional
`capture:acceptance` captures public pages and the free account workflow against
a local server; generated account screenshots and exports stay private.

Daily ingestion tests use explicit local fixtures. Passing those tests is not
proof that a live publisher was reachable or a historical backfill was published.
A missing cron secret fails closed; a missing migration must not break the public
homepage. No new-company discovery provider is configured by the retry endpoint.

## Removed commercial behavior

No checkout, upgrade, downgrade, pricing page, payment webhook or paid-access
gate remains. Tests must not mutate legacy plan columns to obtain export or API
access. Legacy schema columns and migration SQL are retained only for existing
database compatibility and grant no additional privileges.
