import { z } from "zod";

import { CORRECTION_KIND_VALUES } from "@/lib/enums";

/** Emails are stored normalized so uniqueness is case-insensitive. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "请输入邮箱")
    .max(254, "邮箱过长")
    .pipe(z.email("邮箱格式不正确"))
    .transform(normalizeEmail),
  // Length only: an upper bound matters because scrypt hashes whatever it is given.
  password: z.string().min(8, "密码至少 8 位").max(200, "密码过长"),
});

export type Credentials = z.infer<typeof credentialsSchema>;

/**
 * The public subscribe form (T10 / ZCZ-11).
 *
 * Separate from `credentialsSchema` and with no password field, because a
 * subscriber is not an account: the only thing they hand over is an address.
 * Validated here on the server — `type="email"` is a keyboard hint and a
 * courtesy, not a check, and nothing stops a POST that never saw the form.
 *
 * 254 is the RFC 5321 limit on a forward path; anything longer is not an
 * address, it is someone probing.
 */
export const subscribeEmailSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "请输入邮箱")
    .max(254, "邮箱过长")
    .pipe(z.email("邮箱格式不正确"))
    .transform(normalizeEmail),
});

/**
 * The anonymous correction / dispute form (S2-1 / ZCZ-16).
 *
 * `""` means "left blank" for every optional field, because that is what an
 * untouched `<input>` posts — so each of them is normalized to `null` *before*
 * being validated. Without that, a visitor who ignores the optional email box
 * gets "邮箱格式不正确" on a field they were told was optional, and a company
 * trying to correct a record about itself hits a wall over a field that buys
 * them nothing (we cannot send mail yet).
 *
 * Only `kind` and `body` are required. The mirrored bounds — 20–2000 on the
 * quote, `http(s)` on the URL — are the same ones `source` rows must clear, and
 * the page says so out loud: a submission that already meets our own evidence
 * bar is one we can act on without re-reporting it.
 */
const blankToNull = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value));

export const correctionRequestSchema = z.object({
  /** The `slug:impactId` handle from a company page, free text, or nothing. */
  recordRef: blankToNull.pipe(z.string().max(200, "记录标识过长").nullable()),
  kind: z.enum(CORRECTION_KIND_VALUES, { message: "请选择异议类型" }),
  body: z
    .string()
    .trim()
    .min(20, "请把问题说清楚一点（至少 20 字），我们才能核对")
    .max(5000, "正文过长（最多 5000 字），可以只留要点和来源链接"),
  sourceUrl: blankToNull.pipe(
    z
      .string()
      .max(2000, "链接过长")
      .regex(/^https?:\/\//, "来源链接需要以 http:// 或 https:// 开头")
      .nullable(),
  ),
  sourceQuote: blankToNull.pipe(
    z
      .string()
      .min(20, "原文引述至少 20 字符，太短无法核对")
      .max(2000, "原文引述最多 2000 字符")
      .nullable(),
  ),
  email: blankToNull.pipe(
    z.string().max(254, "邮箱过长").pipe(z.email("邮箱格式不正确")).transform(normalizeEmail).nullable(),
  ),
})
  // Mirrors the `correction_request_quote_needs_url` CHECK. A quote with no
  // link is not checkable against anything, and the point of asking for one is
  // that we can open the original ourselves. The reverse is fine.
  .refine((value) => value.sourceQuote === null || value.sourceUrl !== null, {
    path: ["sourceUrl"],
    message: "填了原文引述就请一并给出来源链接，否则我们无法核对",
  });

export type CorrectionRequestInput = z.infer<typeof correctionRequestSchema>;
