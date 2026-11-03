/**
 * Who is allowed to *write* (ZCZ-15).
 *
 * Two values, and deliberately only two: `viewer` is what every account is
 * when it is created, `editor` is what the backoffice requires. A third grade
 * would need a third answer to "what may it do", and nothing in the product
 * asks that question yet.
 *
 * Three rules this file exists to keep apart from everything else:
 *
 *  1. **A role is not a plan.** `src/lib/plans.ts` answers "what did this
 *     account pay for" (bulk export, API keys); this file answers "may this
 *     account change the data". Neither is derived from the other: paying does
 *     not grant write access, and an editor is not a pro subscriber. `can()`
 *     takes a plan and nothing else, and must stay that way.
 *
 *  2. **A role never gates reading.** Browsing needs no account at all, so no
 *     public page (`/`, `/company/*`, `/stats`, `/pricing`, `/subscribe*`) may
 *     look at a role. A role only ever guards `/admin` and the server actions
 *     that write records.
 *
 *  3. **Nothing in here promotes anybody.** There is no "first account becomes
 *     an editor" rule — that would turn an open backoffice into a race — and
 *     no email address is special. `editor` is granted out of band, by a human
 *     running one explicit UPDATE; see `docs/ROLE_GATE.md`.
 */

type NonEmpty<T> = readonly [T, ...T[]];

export const ROLE = {
  /**
   * The default, and what self-service registration produces. An account with
   * no write access is not a useless account: it is the subscription subject
   * (`users.plan`), it owns API keys and it can export. It simply cannot
   * change what the site says about a company.
   */
  viewer: {
    zh: "只读账号",
    en: "Viewer",
    descriptionZh: "可以订阅、导出与使用 API key，不能录入或修改任何记录。",
  },
  /** Record entry, review, publishing, archiving, deleting drafts. */
  editor: {
    zh: "编辑",
    en: "Editor",
    descriptionZh: "可以进入 /admin 后台，录入、审核、发布与下架记录。",
  },
} as const;

export type Role = keyof typeof ROLE;

/**
 * Order matters here: `viewer` is first because `src/db/schema.ts` takes its
 * enum values from this array, and the *lowest* privilege has to be the one the
 * column defaults to.
 */
export const ROLE_VALUES = Object.keys(ROLE) as unknown as NonEmpty<Role>;

/** The least privileged grade. The column default, and what a migration backfills. */
export const DEFAULT_ROLE: Role = "viewer";

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && value in ROLE;
}

/**
 * The only privilege predicate in the codebase.
 *
 * Written as `=== "editor"` rather than as an ordered rank comparison: with two
 * grades a rank buys nothing, and an implicit ordering is how a later grade
 * ends up accidentally above `editor`.
 */
export function isEditor(role: string | null | undefined): boolean {
  return role === "editor";
}

export function labelOfRole(role: string, locale: "zh" | "en" = "zh"): string {
  return (ROLE as Record<string, { zh: string; en: string }>)[role]?.[locale] ?? role;
}

/**
 * Where signing in lands.
 *
 * A viewer must not be sent to `/admin`: the gate there would bounce them
 * straight back out, which reads as a broken login rather than as "this
 * account has no backoffice access".
 */
export function landingPathFor(role: string | null | undefined): string {
  return isEditor(role) ? "/admin" : "/account";
}

/**
 * Where an authenticated non-editor is sent when they ask for `/admin`.
 *
 * Not `/login`: they are already signed in, so a login page would either loop
 * or silently do nothing, and in both cases it hides the actual reason.
 * `/account` renders the reason from this query parameter.
 */
export const ROLE_DENIED_PATH = "/account?denied=admin";
