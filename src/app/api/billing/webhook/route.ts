import { NextResponse } from "next/server";

import { describeBilling } from "@/lib/billing/config";
import { applyPlanChange, findUserById, findUserByStripeCustomerId } from "@/lib/billing/store";
import { StripeError, verifyWebhookSignature, type StripeEvent } from "@/lib/billing/stripe";

/**
 * Stripe's side of the upgrade: `checkout → webhook → plan`.
 *
 * The browser's return trip from Checkout is *not* what upgrades the account.
 * A success_url is just a URL — anyone can open it — so the plan only ever
 * changes here, after a signature check against `STRIPE_WEBHOOK_SECRET`.
 *
 * Idempotency lives in `applyPlanChange`, keyed on the Stripe event id:
 * Stripe retries until it gets a 2xx, so duplicate deliveries are normal
 * operation rather than an error case.
 *
 * Note that the handler works whenever a webhook secret is configured, even
 * with `mode = "simulated"`. That is intentional, and it is how ZCZ-7's
 * "checkout → webhook → 升级" leg is tested without a Stripe account: set a
 * local `whsec_…`, post a correctly signed synthetic event, and the real
 * verification and upgrade code runs. See `scripts/verify-saas-flow.mjs`.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const billing = describeBilling();
  if (!billing.ok) {
    console.error("[billing] webhook rejected:", billing.errorZh);
    return NextResponse.json({ error: "billing_misconfigured" }, { status: 500 });
  }

  const secret = billing.config.webhookSecret;
  if (!secret) {
    // Not an error the caller can fix, and answering 2xx would make Stripe
    // believe the event was handled.
    return NextResponse.json(
      { error: "webhook_not_configured", message: "未配置 STRIPE_WEBHOOK_SECRET。" },
      { status: 503 },
    );
  }

  // The raw text, before any parsing: the signature covers the exact bytes,
  // so re-serialising a parsed object would break verification.
  const rawBody = await request.text();

  let event: StripeEvent;
  try {
    event = verifyWebhookSignature({
      rawBody,
      signatureHeader: request.headers.get("stripe-signature"),
      secret,
    });
  } catch (error) {
    const message = error instanceof StripeError ? error.message : "签名校验失败。";
    // 400, not 500: Stripe stops retrying a 400 and surfaces it in the
    // dashboard, which is the correct outcome for an unverifiable event.
    return NextResponse.json({ error: "invalid_signature", message }, { status: 400 });
  }

  try {
    const outcome = await handleEvent(event);
    return NextResponse.json({ received: true, ...outcome });
  } catch (error) {
    console.error("[billing] webhook handler failed:", error);
    // 500 so Stripe retries; the idempotency ledger makes that safe.
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}

type Outcome = { handled: boolean; detail: string };

async function handleEvent(event: StripeEvent): Promise<Outcome> {
  const object = event.data?.object ?? {};

  switch (event.type) {
    case "checkout.session.completed": {
      const userId = asString(object.client_reference_id) ?? asString(metadataOf(object).user_id);
      if (!userId) {
        return { handled: false, detail: "事件没有带上 client_reference_id，无法定位账号。" };
      }
      const user = await findUserById(userId);
      if (!user) return { handled: false, detail: `账号 ${userId} 不存在。` };

      const result = await applyPlanChange({
        userId,
        plan: "pro",
        source: "stripe_test",
        externalId: event.id,
        type: event.type,
        note: `Stripe 测试模式 checkout session ${asString(object.id) ?? "?"}`,
        stripeCustomerId: asString(object.customer) ?? undefined,
        stripeSubscriptionId: asString(object.subscription) ?? undefined,
      });

      return result.applied
        ? { handled: true, detail: `账号 ${userId} 已升级为 pro。` }
        : { handled: false, detail: `未应用：${result.reason}。` };
    }

    // Cancellation and non-payment both end the entitlement. Treated the same
    // way because, from this side, "the subscription is no longer active" is
    // the only fact that matters.
    case "customer.subscription.deleted":
    case "invoice.payment_failed": {
      const customerId = asString(object.customer);
      const user = customerId ? await findUserByStripeCustomerId(customerId) : null;
      if (!user) {
        return { handled: false, detail: "找不到对应的账号，已忽略。" };
      }

      const result = await applyPlanChange({
        userId: user.id,
        plan: "free",
        source: "stripe_test",
        externalId: event.id,
        type: event.type,
        note: "订阅结束或支付失败，已降级为 free。已签发的 API key 随之停用。",
        stripeSubscriptionId: null,
      });

      return result.applied
        ? { handled: true, detail: `账号 ${user.id} 已降级为 free。` }
        : { handled: false, detail: `未应用：${result.reason}。` };
    }

    default:
      // 200 with `handled: false`. Stripe sends event types nobody subscribed
      // to; retrying them forever would be noise, not safety.
      return { handled: false, detail: `未处理的事件类型 ${event.type}。` };
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function metadataOf(object: Record<string, unknown>): Record<string, unknown> {
  const metadata = object.metadata;
  return metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
}
