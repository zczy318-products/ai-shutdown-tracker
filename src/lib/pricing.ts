/**
 * The money. One module, two hardcoded numbers, everything else derived.
 *
 * The user's 2026-11-03 wording was «9.9 美金包月，包年 8 折». So exactly two
 * facts are inputs here — the monthly price in cents, and the annual discount
 * as a *fraction* (4/5, not a second price) — and the annual total, the
 * effective monthly price, the amount saved and the «8 折» label are all
 * computed from them. Nothing else in the codebase is allowed to hardcode a
 * price: `src/lib/plans.ts` takes its labels from here, the pricing page takes
 * its three annual numbers from here, and Stripe only ever receives a price id
 * (the amount behind that id is configured in Stripe and cannot be validated
 * from this side — see DEPLOY.md §1.2).
 *
 * Why a fraction rather than `ANNUAL_CENTS = 9504`: with two independent
 * numbers, a later price change updates one and forgets the other, and the page
 * ends up promising a discount it does not give. With a fraction that is
 * arithmetically impossible.
 *
 * The one invariant that must never bend:
 *
 *     ANNUAL_CENTS <= MONTHLY_CENTS * 12 * 4 / 5
 *
 * The page says «8 折», so the amount charged may be *lower* than 80% of twelve
 * months (rounding down, a free day, a promo) but never higher. Rounding an
 * annual total *up* to a prettier number — $95.99, $96 — would make that
 * sentence false, which is why `assertPricingInvariants()` runs at import time
 * and throws. It is imported by `src/db/schema.ts`, so a violation fails
 * `npm run build` and `npm run db:generate`, not just a code review.
 *
 * Today all four numbers divide exactly:
 *
 *     monthly            990            US$9.90 / 月
 *     annual list        990 × 12 =  11880
 *     annual charged     11880 × 4/5 = 9504   US$95.04 / 年
 *     effective monthly  9504 ÷ 12 =    792   US$7.92 / 月
 *     saved              11880 − 9504 = 2376  US$23.76 / 年
 *
 * so there is no rounding policy to argue about. The two derived labels that
 * *could* need rounding if the inputs change (effective monthly, months saved)
 * round in the direction that cannot flatter us, and say «约» when they do.
 */

// ---------------------------------------------------------------------------
// Inputs — the only two numbers in this file
// ---------------------------------------------------------------------------

/** US$9.90 / month, in cents. Live since 2026-11-03; unchanged by ZCZ-14. */
export const MONTHLY_CENTS = 990;

/** «8 折» = pay 4/5. A ratio, never a second price. */
export const ANNUAL_DISCOUNT_NUM = 4;
export const ANNUAL_DISCOUNT_DEN = 5;

export const MONTHS_PER_YEAR = 12;

// ---------------------------------------------------------------------------
// Billing intervals
// ---------------------------------------------------------------------------

/**
 * One paid plan, two billing intervals. This is *not* a second tier: see the
 * comment on `ENTITLEMENTS` in `src/lib/plans.ts` — permissions are keyed on
 * the plan alone and an interval buys no extra capability.
 *
 * Kept here rather than in `src/lib/plans.ts` because the interval is a
 * property of the money, and because `src/db/schema.ts` imports this array to
 * build the `billing_interval` pgEnum.
 */
export const BILLING_INTERVAL_VALUES = ["monthly", "annual"] as const;

export type BillingInterval = (typeof BILLING_INTERVAL_VALUES)[number];

export const DEFAULT_BILLING_INTERVAL: BillingInterval = "monthly";

/**
 * The whitelist, in one place.
 *
 * Used for the `?interval=` query parameter *and* for `startUpgrade`, which
 * must reject an unknown value loudly rather than fall back to monthly: a
 * silent fallback would charge a different amount than the button said.
 */
export function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === "string" && (BILLING_INTERVAL_VALUES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Derived amounts
// ---------------------------------------------------------------------------

/** Twelve months at the monthly price — the "before" number, never charged. */
export const ANNUAL_LIST_CENTS = MONTHLY_CENTS * MONTHS_PER_YEAR;

/**
 * What an annual subscription actually costs.
 *
 * `Math.floor`, not `Math.round`: rounding is only ever allowed downwards here
 * (see the invariant at the top of the file).
 */
export const ANNUAL_CENTS = Math.floor((ANNUAL_LIST_CENTS * ANNUAL_DISCOUNT_NUM) / ANNUAL_DISCOUNT_DEN);

/** 11880 − 9504 = 2376. */
export const ANNUAL_SAVING_CENTS = ANNUAL_LIST_CENTS - ANNUAL_CENTS;

/**
 * The annual price expressed per month, for comparison with the monthly price.
 *
 * `Math.ceil`: exact today (9504 ÷ 12 = 792). If a future price does not
 * divide, the displayed figure must not be *lower* than the true average, or
 * the page would quote a monthly price nobody can actually get. `…_IS_EXACT`
 * drives the «约» prefix so an inexact figure is never shown as exact.
 */
export const ANNUAL_EFFECTIVE_MONTHLY_CENTS = Math.ceil(ANNUAL_CENTS / MONTHS_PER_YEAR);

export const ANNUAL_EFFECTIVE_MONTHLY_IS_EXACT =
  ANNUAL_EFFECTIVE_MONTHLY_CENTS * MONTHS_PER_YEAR === ANNUAL_CENTS;

/**
 * The saving expressed in months of the monthly price: 2376 ÷ 990 = 2.4.
 *
 * Truncated to one decimal *downwards*, because this number is a sales claim
 * and the only safe direction for a sales claim is understating it.
 */
export const ANNUAL_SAVING_MONTHS = Math.floor((ANNUAL_SAVING_CENTS / MONTHLY_CENTS) * 10) / 10;

export const ANNUAL_SAVING_MONTHS_IS_EXACT =
  ANNUAL_SAVING_MONTHS * MONTHLY_CENTS === ANNUAL_SAVING_CENTS;

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

export class PricingInvariantError extends Error {
  constructor(message: string) {
    super(`定价不变量被破坏：${message}`);
    this.name = "PricingInvariantError";
  }
}

/**
 * Runs at import time. Deliberately not a test: a test you can forget to run,
 * whereas this breaks the build of any page that renders a price.
 */
export function assertPricingInvariants(): void {
  if (!Number.isInteger(MONTHLY_CENTS) || MONTHLY_CENTS <= 0) {
    throw new PricingInvariantError(`MONTHLY_CENTS 必须是正整数分，当前 ${MONTHLY_CENTS}`);
  }
  if (
    !Number.isInteger(ANNUAL_DISCOUNT_NUM) ||
    !Number.isInteger(ANNUAL_DISCOUNT_DEN) ||
    ANNUAL_DISCOUNT_NUM <= 0 ||
    ANNUAL_DISCOUNT_DEN <= 0 ||
    ANNUAL_DISCOUNT_NUM > ANNUAL_DISCOUNT_DEN
  ) {
    throw new PricingInvariantError(
      `折扣必须是 (0, 1] 之间的整数比，当前 ${ANNUAL_DISCOUNT_NUM}/${ANNUAL_DISCOUNT_DEN}`,
    );
  }
  if (!Number.isInteger(ANNUAL_CENTS) || ANNUAL_CENTS <= 0) {
    throw new PricingInvariantError(`ANNUAL_CENTS 必须是正整数分，当前 ${ANNUAL_CENTS}`);
  }

  // The one that matters. Cross-multiplied so the comparison is exact integer
  // arithmetic — a float division here could pass a price that is one cent
  // over the discount it advertises.
  if (ANNUAL_CENTS * ANNUAL_DISCOUNT_DEN > ANNUAL_LIST_CENTS * ANNUAL_DISCOUNT_NUM) {
    throw new PricingInvariantError(
      `年付 ${ANNUAL_CENTS} 分高于 ${ANNUAL_DISCOUNT_NUM}/${ANNUAL_DISCOUNT_DEN} 折后的 ` +
        `${(ANNUAL_LIST_CENTS * ANNUAL_DISCOUNT_NUM) / ANNUAL_DISCOUNT_DEN} 分。` +
        "页面上写着折扣，收的钱就不能多于折后价（只许向下取整）。",
    );
  }

  if (ANNUAL_CENTS >= ANNUAL_LIST_CENTS) {
    throw new PricingInvariantError("年付不比按月付满 12 个月便宜，「包年优惠」就是假话。");
  }
}

assertPricingInvariants();

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * `990` → `US$9.90`.
 *
 * Always two decimals and always the `US$` prefix: the currency is USD for
 * every visitor, and the one bug this product has already shipped once was a
 * page quoting CNY 49 a month while the user had decided on dollars. There is
 * no locale switch here on purpose — and no yuan sign anywhere under `src/`,
 * which `npm run verify:saas` asserts against the rendered page.
 */
export function formatUsd(cents: number): string {
  return `US$${(cents / 100).toFixed(2)}`;
}

/** Trims a derived decimal for display: `8` not `8.0`, `2.4` not `2.40`. */
function trimDecimal(value: number): string {
  return String(Number(value.toFixed(1)));
}

/** «8 折» — derived from the ratio, so it cannot disagree with the amount. */
export const ANNUAL_DISCOUNT_LABEL_ZH = `${trimDecimal(
  (ANNUAL_DISCOUNT_NUM * 10) / ANNUAL_DISCOUNT_DEN,
)} 折`;

export const MONTHLY_PRICE_LABEL = `${formatUsd(MONTHLY_CENTS)} / 月`;
export const ANNUAL_PRICE_LABEL = `${formatUsd(ANNUAL_CENTS)} / 年`;

export const ANNUAL_EFFECTIVE_MONTHLY_LABEL = `${
  ANNUAL_EFFECTIVE_MONTHLY_IS_EXACT ? "" : "约 "
}${formatUsd(ANNUAL_EFFECTIVE_MONTHLY_CENTS)} / 月`;

export const ANNUAL_SAVING_LABEL = formatUsd(ANNUAL_SAVING_CENTS);

export const ANNUAL_SAVING_MONTHS_LABEL = `${
  ANNUAL_SAVING_MONTHS_IS_EXACT ? "" : "约 "
}${trimDecimal(ANNUAL_SAVING_MONTHS)} 个月`;

/**
 * Everything the UI needs per interval, so a component never has to branch on
 * the interval string to pick a price or a unit.
 *
 * `envVar` is the Stripe price-id variable for that interval, named here so an
 * error message can tell a deployer exactly which variable is missing instead
 * of making them read the code.
 */
export const BILLING_INTERVAL: Record<
  BillingInterval,
  {
    zh: string;
    /** «每月» / «每年» unit, for sentences. */
    unitZh: string;
    cents: number;
    priceLabel: string;
    envVar: string;
  }
> = {
  monthly: {
    zh: "按月",
    unitZh: "月",
    cents: MONTHLY_CENTS,
    priceLabel: MONTHLY_PRICE_LABEL,
    envVar: "STRIPE_PRICE_ID_PRO_MONTHLY",
  },
  annual: {
    zh: "按年",
    unitZh: "年",
    cents: ANNUAL_CENTS,
    priceLabel: ANNUAL_PRICE_LABEL,
    envVar: "STRIPE_PRICE_ID_PRO_ANNUAL",
  },
};

export function labelOfBillingInterval(interval: string | null | undefined): string | null {
  return isBillingInterval(interval) ? BILLING_INTERVAL[interval].zh : null;
}
