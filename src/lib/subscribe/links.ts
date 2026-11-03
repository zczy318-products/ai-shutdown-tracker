import { headers } from "next/headers";

/**
 * Absolute URLs for the links that go into an email.
 *
 * `NEXT_PUBLIC_APP_URL`, then Vercel's `VERCEL_URL`, then the request's own
 * `Host`. The header fallback is what lets local development and the
 * verification script produce working links on any port with no configuration.
 *
 * That fallback trusts `Host`, which a client controls. Survivable here and
 * nowhere else: the only links built this way are mailed to the address the
 * same request supplied, so a forged `Host` sends a broken link to the forger.
 * Never reuse this for a password reset or anything sent to a third party.
 *
 * (`src/lib/billing/config.ts` resolves an origin too, for Stripe's redirects.
 * It is a private function there and has no request to fall back on, so the
 * two stay separate rather than one importing the other.)
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;

  const h = await headers();
  const host = h.get("host") ?? "127.0.0.1:3000";
  const isLoopback = /^(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(host);
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? (isLoopback ? "http" : "https");
  return `${proto}://${host}`;
}

export async function confirmUrl(token: string): Promise<string> {
  return `${await siteOrigin()}/subscribe/confirm?token=${encodeURIComponent(token)}`;
}

export async function unsubscribeUrl(token: string): Promise<string> {
  return `${await siteOrigin()}/subscribe/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * Where the signup came from, for the `subscriber.source` column. Normally the
 * path of the page the form was on, e.g. `/` or `/company/chegg`.
 *
 * The form posts this in a hidden field, so it is attacker-controlled input
 * that gets stored. Unknown shapes are replaced with `unknown` rather than
 * rejected: a tampered hidden field must not change what the visitor sees,
 * because the response to a subscribe submission has to be identical in every
 * case. 120 chars to match the column.
 */
export function normalizeSubscribeSource(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const allowed = /^[a-z0-9/][a-z0-9/:._-]{0,119}$/.test(value) && !value.includes("..");
  return allowed ? value : "unknown";
}
