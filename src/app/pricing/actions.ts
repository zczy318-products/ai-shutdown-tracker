"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { BillingConfigError, resolveBillingConfig } from "@/lib/billing/config";
import { applyPlanChange } from "@/lib/billing/store";
import { StripeError, createCheckoutSession } from "@/lib/billing/stripe";

/**
 * Starting and undoing an upgrade.
 *
 * Two backends behind one button, chosen by `resolveBillingConfig()`:
 *
 *   stripe_test  create a test-mode Checkout Session and send the browser to
 *                Stripe. The plan does *not* change here — it changes when
 *                `/api/billing/webhook` verifies the resulting event.
 *   simulated    flip the plan directly and log it as a simulated change.
 *
 * The simulated path exists because ZCZ-7 forbids registering third-party
 * accounts, so the whole free → pro → export → API-key chain has to be
 * demonstrable with nothing external configured at all. It is not a backdoor
 * around payment: there is no payment to go around, the account page labels
 * the result as a simulation, and `billing_events` records it as one.
 */

export type BillingFormState = { error: string } | { ok: true; message: string } | null;

export async function startUpgrade(
  _prev: BillingFormState,
  _formData: FormData,
): Promise<BillingFormState> {
  const user = await getCurrentUser();
  // Anonymous visitors are sent to register rather than refused. Nothing they
  // could already read is behind this; the account is only the billing
  // subject.
  if (!user) redirect("/register?from=pricing");

  if (user.plan === "pro") {
    return { ok: true, message: "这个账号已经是专业版了。" };
  }

  let checkoutUrl: string | null = null;

  try {
    const config = resolveBillingConfig();

    if (config.mode === "simulated") {
      const result = await applyPlanChange({
        userId: user.id,
        plan: "pro",
        source: "simulated",
        // Not a Stripe id, and shaped so it can never be mistaken for one.
        externalId: `sim:${randomUUID()}`,
        type: "simulated.upgrade",
        note: "本地模拟升级：未接入 Stripe，没有任何真实扣款。",
      });
      if (!result.applied) {
        return { error: `升级未生效（${result.reason}）。请刷新后重试。` };
      }
    } else {
      if (!config.priceId) {
        return {
          error:
            "已配置 Stripe 测试密钥，但缺少 STRIPE_PRICE_ID_PRO。" +
            "请补上测试模式的 price id，或移除 STRIPE_SECRET_KEY 以回退到本地模拟升级。",
        };
      }
      const session = await createCheckoutSession({
        secretKey: config.secretKey!,
        priceId: config.priceId,
        userId: user.id,
        customerEmail: user.email,
        customerId: user.stripeCustomerId,
        successUrl: `${config.appUrl}/account?checkout=success`,
        cancelUrl: `${config.appUrl}/pricing?checkout=cancelled`,
      });
      checkoutUrl = session.url;
    }
  } catch (error) {
    if (error instanceof BillingConfigError) return { error: error.message };
    if (error instanceof StripeError) return { error: `Stripe 调用失败：${error.message}` };
    console.error("[billing] upgrade failed:", error);
    return { error: "升级流程启动失败，请稍后重试。" };
  }

  // Outside the try: `redirect` works by throwing, so catching it here would
  // turn every successful upgrade into the generic error above.
  if (checkoutUrl) redirect(checkoutUrl);

  revalidatePath("/account");
  revalidatePath("/pricing");
  redirect("/account?upgraded=simulated");
}

/**
 * Drops the account back to free.
 *
 * Only offered in simulated mode. With Stripe configured, a cancellation has
 * to come back as a webhook event, and a local button that quietly disagreed
 * with Stripe's view of the subscription would be worse than no button.
 */
export async function simulateDowngrade(
  _prev: BillingFormState,
  _formData: FormData,
): Promise<BillingFormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  try {
    const config = resolveBillingConfig();
    if (config.mode !== "simulated") {
      return {
        error: "当前已接入 Stripe 测试模式，降级请在 Stripe 侧取消订阅，由 webhook 回写。",
      };
    }

    const result = await applyPlanChange({
      userId: user.id,
      plan: "free",
      source: "simulated",
      externalId: `sim:${randomUUID()}`,
      type: "simulated.downgrade",
      note: "本地模拟降级：用于验证导出与 API key 会随之失效。",
    });
    if (!result.applied) {
      return { error: `降级未生效（${result.reason}）。` };
    }
  } catch (error) {
    if (error instanceof BillingConfigError) return { error: error.message };
    console.error("[billing] downgrade failed:", error);
    return { error: "降级失败，请稍后重试。" };
  }

  revalidatePath("/account");
  revalidatePath("/pricing");
  return { ok: true, message: "已降级为免费档。全量导出与 API key 已同时停用。" };
}
