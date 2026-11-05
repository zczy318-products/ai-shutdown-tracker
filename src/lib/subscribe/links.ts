import { headers } from "next/headers";

/** Require a trusted deployment origin; request headers are only used for loopback development. */
export function trustedOrigin(raw: string): string {
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new Error("Invalid application origin");
  }
  return url.origin;
}

export async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return trustedOrigin(configured);
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return trustedOrigin(`https://${vercel}`);
  const h = await headers();
  const host = h.get("host") ?? "127.0.0.1:3000";
  const url = new URL(`http://${host}`);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("NEXT_PUBLIC_APP_URL is required outside loopback development");
  }
  return trustedOrigin(url.href);
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
