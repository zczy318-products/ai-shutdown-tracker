/**
 * Which billing backend is live, and the guard rails around it.
 *
 * Two modes, resolved from the environment rather than from a build flag:
 *
 *   `stripe_test`  STRIPE_SECRET_KEY is set. Checkout goes to Stripe's test
 *                  mode, and `/api/billing/webhook` upgrades the account when
 *                  the event comes back.
 *   `simulated`    No Stripe key. A local "模拟升级" switch flips the plan
 *                  directly, so the whole free → pro → export → API-key chain
 *                  is demonstrable with no third-party account at all.
 *
 * ZCZ-7 forbids real payment capture outright, so this module refuses a live
 * key instead of trusting whoever configured the deployment to have read the
 * ticket. `sk_live_…` is a hard failure at resolve time, not a warning in a
 * log nobody reads: the cost of a false positive here is a broken checkout
 * button, and the cost of a false negative is charging somebody money.
 */

export type BillingMode = "stripe_test" | "simulated";

export type BillingConfig = {
  mode: BillingMode;
  /** Present only in `stripe_test` mode. Always an `sk_test_…` key. */
  secretKey?: string;
  priceId?: string;
  webhookSecret?: string;
  /** Absolute origin for Stripe's redirect URLs. */
  appUrl: string;
  /**
   * Why the resolved mode is what it is, shown in the UI. Users deserve to
   * know a "subscription" is a demo before they click it.
   */
  reasonZh: string;
};

export class BillingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingConfigError";
  }
}

const LIVE_KEY_PREFIXES = ["sk_live_", "rk_live_"];

function trimmed(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Best-effort absolute origin. Vercel injects `VERCEL_URL` without a scheme;
 * local development falls back to the dev server's default.
 */
function resolveAppUrl(): string {
  const explicit = trimmed("NEXT_PUBLIC_APP_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = trimmed("VERCEL_URL");
  if (vercel) return `https://${vercel}`;
  return "http://127.0.0.1:3000";
}

export function resolveBillingConfig(): BillingConfig {
  const appUrl = resolveAppUrl();
  const secretKey = trimmed("STRIPE_SECRET_KEY");

  // An explicit override, for testing the simulated path on a machine that
  // happens to have test keys in its .env.local.
  if (trimmed("BILLING_SIMULATION") === "true") {
    return {
      mode: "simulated",
      appUrl,
      reasonZh: "BILLING_SIMULATION=true：已强制使用本地模拟升级。",
    };
  }

  if (!secretKey) {
    return {
      mode: "simulated",
      appUrl,
      // The webhook secret is still honoured in simulated mode: it lets the
      // real signature-verification path be exercised without a Stripe
      // account, which is how ZCZ-7's webhook leg is tested here.
      webhookSecret: trimmed("STRIPE_WEBHOOK_SECRET"),
      reasonZh: "未配置 STRIPE_SECRET_KEY：使用本地模拟升级，不接触任何外部支付服务。",
    };
  }

  if (LIVE_KEY_PREFIXES.some((prefix) => secretKey.startsWith(prefix))) {
    throw new BillingConfigError(
      "STRIPE_SECRET_KEY 是一个 live 模式密钥。本项目只允许测试模式（sk_test_…），" +
        "拒绝启动结账流程。请换成测试密钥，或删除该变量以使用本地模拟升级。",
    );
  }

  if (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("rk_test_")) {
    throw new BillingConfigError(
      "STRIPE_SECRET_KEY 的前缀无法识别为测试密钥（应为 sk_test_… 或 rk_test_…）。" +
        "为避免误用真实收款，拒绝使用该密钥。",
    );
  }

  return {
    mode: "stripe_test",
    secretKey,
    priceId: trimmed("STRIPE_PRICE_ID_PRO"),
    webhookSecret: trimmed("STRIPE_WEBHOOK_SECRET"),
    appUrl,
    reasonZh: "已配置 Stripe 测试模式密钥（sk_test_…）：结账走 Stripe 测试环境，不产生真实扣款。",
  };
}

/**
 * Non-throwing variant for render paths. A misconfiguration should turn into
 * a visible explanation on the pricing page, not a 500.
 */
export function describeBilling():
  | { ok: true; config: BillingConfig }
  | { ok: false; errorZh: string } {
  try {
    return { ok: true, config: resolveBillingConfig() };
  } catch (error) {
    return {
      ok: false,
      errorZh: error instanceof BillingConfigError ? error.message : "计费配置无法解析。",
    };
  }
}
