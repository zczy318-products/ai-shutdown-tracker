"use server";

import { clientIp } from "@/lib/client-ip";
import { hashClientIp, submitCorrection } from "@/lib/corrections/store";
import { normalizeSubscribeSource } from "@/lib/subscribe/links";
import { consumeRateLimit } from "@/lib/subscribe/store";
import { correctionRequestSchema } from "@/lib/validation";

/** The six form fields, exactly as they were typed. See `CorrectionFormState`. */
export type CorrectionFormValues = {
  recordRef: string;
  kind: string;
  body: string;
  sourceUrl: string;
  sourceQuote: string;
  email: string;
};

const FIELDS = [
  "recordRef",
  "kind",
  "body",
  "sourceUrl",
  "sourceQuote",
  "email",
] as const satisfies readonly (keyof CorrectionFormValues)[];

export type CorrectionFormState =
  | null
  /** Accepted and in the queue. Carries nothing — see the note below. */
  | { status: "ok" }
  /**
   * Rejected. `values` is what they typed and `attempt` increments every time,
   * which together are what let the form come back filled in: React 19 resets
   * an uncontrolled form once its action resolves, so the client remounts the
   * fields on a new `attempt` with `values` as their defaults. Somebody who
   * wrote four paragraphs disputing a record about their own company does not
   * get to lose them to a typo'd URL.
   */
  | { status: "error"; message: string; attempt: number; values: CorrectionFormValues };

/**
 * The `/corrections` form's only entry point. Anonymous, by design.
 *
 * ## No account, and no account-shaped side effects
 *
 * Nothing here reads a session, creates a user, or sets a cookie. A company
 * trying to correct a record about itself must not have to register first — the
 * product口径 says so, and an implementation that quietly looked at
 * `getCurrentUser()` to decide anything would be the same wall with better
 * manners.
 *
 * ## Why the success state carries nothing
 *
 * `{ status: "ok" }` and nothing else, so the page cannot accidentally promise
 * something. There is no mail provider wired up (user decision, 2026-11-03:
 * collect only, never send), so there is no receipt, no ticket number and no
 * reply-by date to hand back — and a submission id would read exactly like the
 * ticket number of a system that is going to write to you. The page says, in
 * Product PM's words, that the outcome will appear on the record itself.
 *
 * A de-duplicated submission returns the same `ok`. Telling a visitor "you
 * already sent this" would confirm to anyone probing that a particular text is
 * in our queue, and it would also punish the honest case — somebody resending
 * because nothing visibly happened the first time.
 *
 * ## Abuse control is the subscribe form's, not a new one
 *
 * `consumeRateLimit("ip", …)` is the same database-backed budget `/subscribe`
 * uses, deliberately sharing the same bucket rather than adding a scope: one
 * client flooding the site is one flood, whichever of the two public forms it
 * points at. The per-address budget next door has no counterpart here, because
 * the email field on this form is optional — making it a throttle key would
 * reward leaving it blank.
 */
export async function submitCorrectionRequest(
  prev: CorrectionFormState,
  formData: FormData,
): Promise<CorrectionFormState> {
  const values = Object.fromEntries(
    FIELDS.map((field) => [field, String(formData.get(field) ?? "")]),
  ) as CorrectionFormValues;

  const attempt = (prev?.status === "error" ? prev.attempt : 0) + 1;
  const reject = (message: string): CorrectionFormState => ({
    status: "error",
    message,
    attempt,
    values,
  });

  // Shape first, with no database access: junk input must not be able to make
  // us write throttle rows. Same ordering as `subscribe`.
  const parsed = correctionRequestSchema.safeParse(values);
  if (!parsed.success) {
    return reject(parsed.error.issues[0]?.message ?? "提交内容不符合要求");
  }

  const ip = await clientIp();
  const withinBudget = await consumeRateLimit("ip", ip);
  if (!withinBudget) {
    return reject("提交过于频繁，请稍后再试。");
  }

  try {
    await submitCorrection({
      ...parsed.data,
      source: normalizeSubscribeSource(formData.get("source")),
      // Hashed here, never stored raw. See `correction_request.ip_hash`.
      ipHash: ip === "unknown" ? null : hashClientIp(ip),
    });
  } catch (error) {
    // The database CHECK constraints mirror the Zod schema, so reaching this is
    // either a bug or an outage — not something the visitor can fix by editing
    // their text. Say so instead of blaming their input, and hand the text back
    // so a retry is one click rather than a retype.
    console.error("[corrections] submission failed:", error);
    return reject("提交没有成功保存，这是我们这边的问题。请稍后重试，你填的内容还在。");
  }

  return { status: "ok" };
}
