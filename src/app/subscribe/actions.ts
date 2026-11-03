"use server";

import { headers } from "next/headers";

import { getMailer } from "@/lib/mailer";
import { confirmSubscriptionEmail } from "@/lib/subscribe/emails";
import { confirmUrl, normalizeSubscribeSource, unsubscribeUrl } from "@/lib/subscribe/links";
import { consumeRateLimit, requestSubscription } from "@/lib/subscribe/store";
import { subscribeEmailSchema } from "@/lib/validation";

export type SubscribeFormState =
  | null
  /**
   * The submission was accepted. `canDeliver` is a property of the configured
   * mail driver, *not* of this submission — see the enumeration note below.
   */
  | { status: "ok"; canDeliver: boolean }
  | { status: "error"; message: string };

/**
 * Best-effort client address for the IP throttle.
 *
 * On Vercel these headers are set by the platform edge and can be trusted. On a
 * deployment with no trusted proxy in front, `x-forwarded-for` is just a
 * request header and anyone can rotate it — which is why the per-address budget
 * exists as well, and why it is the tighter of the two.
 *
 * A request with no usable header falls into a single shared `unknown` bucket.
 * That fails closed rather than open: an unidentifiable flood gets throttled
 * together instead of waved through.
 */
async function clientIp(): Promise<string> {
  const h = await headers();
  const candidate =
    h.get("x-vercel-forwarded-for")?.trim() ||
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return candidate || "unknown";
}

/**
 * The public subscribe form's only entry point.
 *
 * ## Why every success path returns the same thing
 *
 * A new address, an address that is already pending, and an address that is
 * already confirmed all return `{ status: "ok", canDeliver }` with identical
 * wording on the page. If they did not, this one-field form would answer the
 * question "is this person subscribed to your site?" for any address a stranger
 * cares to type — a form that needs no account to use must not become a lookup
 * API for who uses the site.
 *
 * That is also why `canDeliver` comes from the mail driver rather than from the
 * `MailResult`: the already-confirmed branch sends no mail at all, so a flag
 * derived from "did we send something" would differ between branches and leak
 * exactly what the wording was built to hide.
 *
 * The remaining channel is timing — the branches that send mail do a provider
 * round-trip. With the `log` driver there is nothing to time; the note in
 * `src/lib/mailer.ts` tells whoever wires a provider to send out of band.
 */
export async function subscribe(
  _prev: SubscribeFormState,
  formData: FormData,
): Promise<SubscribeFormState> {
  // Format first, and with no database access: a flood of junk input should not
  // be able to make us write throttle rows.
  const parsed = subscribeEmailSchema.safeParse({ email: String(formData.get("email") ?? "") });
  if (!parsed.success) {
    return { status: "error", message: parsed.error.issues[0]?.message ?? "邮箱格式不正确" };
  }

  const { email } = parsed.data;
  const source = normalizeSubscribeSource(formData.get("source"));

  // Both budgets are consumed before any subscriber row is touched. Same
  // message for both, because which budget ran out is not the visitor's
  // problem and the email budget being named would itself be a signal.
  const withinIpBudget = await consumeRateLimit("ip", await clientIp());
  const withinEmailBudget = await consumeRateLimit("email", email);
  if (!withinIpBudget || !withinEmailBudget) {
    return { status: "error", message: "提交过于频繁，请稍后再试。" };
  }

  const mailer = getMailer();
  const result = await requestSubscription({ email, source });

  if (result.kind === "confirm_pending") {
    const message = confirmSubscriptionEmail({
      email,
      confirmUrl: await confirmUrl(result.confirmToken),
      unsubscribeUrl: await unsubscribeUrl(result.unsubToken),
    });
    // The result is deliberately not used to shape the response: it is logged
    // by the driver, and a delivery failure must not tell the visitor whether
    // their address was new.
    await mailer.send(message);
  }

  return { status: "ok", canDeliver: mailer.canDeliver };
}
