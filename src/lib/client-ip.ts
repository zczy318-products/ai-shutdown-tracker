import { headers } from "next/headers";

/**
 * Best-effort client address, for the throttles on the public forms.
 *
 * On Vercel these headers are set by the platform edge and can be trusted. On a
 * deployment with no trusted proxy in front, `x-forwarded-for` is just a
 * request header and anyone can rotate it — which is why the per-address budget
 * on the subscribe form exists as well, and why it is the tighter of the two.
 *
 * A request with no usable header falls into a single shared `unknown` bucket.
 * That fails closed rather than open: an unidentifiable flood gets throttled
 * together instead of waved through.
 *
 * Extracted from `src/app/subscribe/actions.ts` when `/corrections` (ZCZ-16)
 * needed the same value. One copy, because two copies of "which header do we
 * trust" is how one of them ends up trusting a header the deployment does not
 * set. The return value is only ever used as a throttle key or hashed into a
 * digest — never stored in plaintext, never shown to anybody.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const candidate =
    h.get("x-vercel-forwarded-for")?.trim() ||
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return candidate || "unknown";
}
