# Security

## Reporting

Do not post credentials, subscriber data, session cookies, or exploit details in
public issues. Contact the repository maintainers privately, or use GitHub's
private vulnerability reporting if enabled. Include the affected revision,
reproduction steps using synthetic data, impact, and a proposed mitigation.

## Supported deployment

Use the latest reviewed revision and a supported Node.js release. Run `npm ci`
from the committed lockfile. Before publication or an upgrade, run:

```sh
git fetch --all --prune
npm run security:secrets
npm audit
npm run verify:security
npm run typecheck
npm run build
```

The secret command requires Gitleaks and scans fetched Git history with default
rules plus the application's API-key rule. Also scan the intended working-tree
export, including screenshots and other binary artifacts. A clean scan is not
proof that no credential exists: investigate detections, inspect context, and
never suppress an actual secret as a fixture.

## Access and data boundaries

- Self-registration creates a regular account. Only UUIDs explicitly configured
  in `ADMIN_USER_IDS` can read administrator pages or invoke editorial actions.
  Do not use an unverified email address or an old demonstration account to
  identify an administrator.
- Passwords use salted scrypt; sessions, API keys, and subscription tokens store
  only digests. API keys access published data and cannot administer the site.
- Public CSV and JSON exports intentionally contain evidence quotations. They
  must not contain account hashes, subscriber addresses, or private draft data.
- Real secrets belong in ignored environment files or deployment secret stores.
  Keep secrets out of `NEXT_PUBLIC_` variables, logs and screenshots.
- No payment integration remains. Historical database fields and migrations are
  retained for compatibility and confer no privileges.

## Operational limits

Authentication and subscription throttles use durable database counters. Configure
a trusted reverse proxy as described in [DEPLOY.md](DEPLOY.md); without one,
unidentified clients share a conservative limit. Apply perimeter controls for
public read traffic and bulk exports when operating a public service.

Mail delivery is disabled and logs redact message content by default. Only
isolated local development tests may opt in to content logging. Historical logs,
backups, deployment variables, and external service credentials require a separate
operator review. If a credential was exposed, revoke or rotate it first; removing
it from the latest commit does not remove it from history or invalidate it.

See the [security review](docs/SECURITY_REVIEW.md) for the actual tested scope and
remaining release steps. Repository visibility and licensing are separate release
decisions; passing checks does not publish the repository.
