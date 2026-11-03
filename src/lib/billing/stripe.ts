import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The two pieces of Stripe we actually use, spoken over plain `fetch`.
 *
 * No `stripe` npm package. We need exactly one API call (create a Checkout
 * Session) and one signature check, both of which are a few lines against a
 * documented, stable HTTP interface. Pulling in the SDK would add a dependency
 * to the serverless bundle, and — more to the point — would hide the one thing
 * this integration has to be auditable about: that it only ever talks to test
 * mode and never captures a payment itself.
 *
 * Everything here assumes `resolveBillingConfig()` already refused live keys.
 */

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_API_VERSION = "2024-06-20";

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "StripeError";
  }
}

/**
 * Stripe's API takes `application/x-www-form-urlencoded` with bracketed keys
 * for nesting (`line_items[0][price]`), not JSON.
 */
function encodeForm(params: Record<string, string | number | boolean | undefined>): string {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    body.set(key, String(value));
  }
  return body.toString();
}

export type CheckoutSession = { id: string; url: string };

/**
 * Creates a test-mode subscription Checkout Session.
 *
 * `client_reference_id` carries our own user id through Stripe and back on the
 * webhook, which is what lets the webhook upgrade the right account without
 * trusting anything in the browser's return trip.
 */
export async function createCheckoutSession(options: {
  secretKey: string;
  priceId: string;
  userId: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
  /** Reuses the Stripe customer if the account already has one. */
  customerId?: string | null;
}): Promise<CheckoutSession> {
  const params: Record<string, string | undefined> = {
    mode: "subscription",
    "line_items[0][price]": options.priceId,
    "line_items[0][quantity]": "1",
    success_url: options.successUrl,
    cancel_url: options.cancelUrl,
    client_reference_id: options.userId,
    "metadata[user_id]": options.userId,
    "subscription_data[metadata][user_id]": options.userId,
  };

  // Stripe rejects `customer` and `customer_email` together.
  if (options.customerId) params.customer = options.customerId;
  else params.customer_email = options.customerEmail;

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": STRIPE_API_VERSION,
      // Retrying a failed checkout must not create a second subscription.
      "idempotency-key": `checkout:${options.userId}:${options.priceId}`,
    },
    body: encodeForm(params),
  });

  const payload = (await res.json().catch(() => null)) as
    | { id?: string; url?: string; error?: { message?: string } }
    | null;

  if (!res.ok) {
    throw new StripeError(
      payload?.error?.message ?? `Stripe 返回 ${res.status}`,
      res.status,
    );
  }
  if (!payload?.id || !payload.url) {
    throw new StripeError("Stripe 没有返回 checkout session 的跳转地址。");
  }

  return { id: payload.id, url: payload.url };
}

// ---------------------------------------------------------------------------
// Webhook signature
// ---------------------------------------------------------------------------

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

/**
 * Verifies a `Stripe-Signature` header against the raw request body.
 *
 * The header looks like `t=1699000000,v1=<hex>,v1=<hex>`; the signed payload is
 * `${t}.${rawBody}`, HMAC-SHA256 with the endpoint's `whsec_…`. Several `v1`
 * values can be present while a secret is being rotated, so any match counts.
 *
 * The timestamp tolerance is the replay defence: without it, a signature
 * captured once stays valid forever. Comparison is `timingSafeEqual`, because
 * a byte-at-a-time `===` on a MAC is a forgery oracle.
 *
 * Returns the parsed event, or throws — a webhook that cannot be verified must
 * never reach the plan-upgrade code.
 */
export function verifyWebhookSignature(options: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
  toleranceSeconds?: number;
  now?: number;
}): StripeEvent {
  const { rawBody, signatureHeader, secret } = options;
  const tolerance = options.toleranceSeconds ?? 300;
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);

  if (!signatureHeader) {
    throw new StripeError("缺少 Stripe-Signature 头。", 400);
  }

  let timestamp = "";
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key?.trim() === "t") timestamp = value?.trim() ?? "";
    else if (key?.trim() === "v1" && value) signatures.push(value.trim());
  }

  if (!timestamp || signatures.length === 0) {
    throw new StripeError("Stripe-Signature 头格式无法解析。", 400);
  }

  const age = nowSeconds - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > tolerance) {
    throw new StripeError(`Stripe 事件时间戳超出 ${tolerance} 秒容忍窗口。`, 400);
  }

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const matched = signatures.some((candidate) => {
    const given = Buffer.from(candidate, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });

  if (!matched) {
    throw new StripeError("Stripe 事件签名校验失败。", 400);
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    throw new StripeError("Stripe 事件不是合法 JSON。", 400);
  }
  if (!event?.id || !event.type) {
    throw new StripeError("Stripe 事件缺少 id 或 type。", 400);
  }

  return event;
}

/** The counterpart of the above, used by the verification script. */
export function signWebhookPayload(options: {
  rawBody: string;
  secret: string;
  timestampSeconds?: number;
}): string {
  const t = options.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", options.secret)
    .update(`${t}.${options.rawBody}`)
    .digest("hex");
  return `t=${t},v1=${signature}`;
}
