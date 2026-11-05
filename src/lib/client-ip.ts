import { isIP } from "node:net";

/** Only trust address headers supplied by the configured reverse proxy. */
export function clientAddress(h: Headers): string {
  const candidate = process.env.VERCEL === "1"
    ? h.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    : process.env.TRUST_PROXY === "true"
      ? h.get("x-forwarded-for")?.split(",")[0]?.trim()
      : undefined;
  return candidate && isIP(candidate) ? candidate : "unknown";
}
