# Email Subscription

The public form records subscription requests. No email provider is configured and no email is delivered. The UI must say that delivery is unavailable; an accepted request is not a confirmed subscription.

## Data and access

- Addresses are normalized and stored separately from login accounts.
- Confirmation tokens expire after seven days and can be spent only once. Only SHA-256 token digests are stored.
- Unsubscribe tokens are revocable capabilities. Never publish them, their links, or subscriber exports.
- Every subscriber administration page checks `requireAdmin()` before querying data. Set `ADMIN_USER_IDS` to explicitly authorize an account; registering an account does not authorize administration.
- Durable per-address and per-client counters limit submissions. Address headers are trusted only on the configured platform/proxy.

## Logging and origins

The log driver returns `delivered: false`. Recipient addresses and message bodies are redacted by default, including in development. `MAIL_LOG_CONTENT=true` is available only for isolated local tests; production processes and Vercel always ignore it. Never use that switch with real subscriber data.

Configure `NEXT_PUBLIC_APP_URL` to the canonical HTTPS origin, or use the platform-provided `VERCEL_URL`. Arbitrary request hosts and forwarded protocols cannot determine confirmation links. Loopback development accepts an HTTP origin on the local port.

## Verification

Run `npm run verify:subscribe`. It creates an isolated database, provisions a fixture administrator by immutable ID, and starts a local development server. Synthetic addresses and tokens exercise confirmation, replay, expiry, unsubscribe, re-subscription, rate limits, and administrator-only access. Tokens and raw server logs must not be printed in its output.

`npm run verify:security` separately verifies that default and production mail logs redact recipient and token content. Link-bearing routes use the global `Referrer-Policy: no-referrer` response header.
