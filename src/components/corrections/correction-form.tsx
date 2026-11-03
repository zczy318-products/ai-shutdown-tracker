"use client";

import { usePathname } from "next/navigation";
import { useActionState } from "react";

import {
  submitCorrectionRequest,
  type CorrectionFormState,
} from "@/app/(public)/corrections/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CORRECTION_KIND, optionsOf } from "@/lib/enums";

/**
 * The anonymous correction / dispute form.
 *
 * Two fields are required — what kind of problem, and what is wrong. Everything
 * else, the email included, is optional and labelled as optional. That is the
 * product constraint, not a convenience: a company correcting a record about
 * itself must be able to submit without handing us a way to contact them, and
 * without an account.
 *
 * `required` and `type="url"` are keyboard hints and browser courtesies.
 * `correctionRequestSchema` re-validates server-side, and the
 * `correction_request` CHECK constraints re-validate under that, because
 * nothing stops a POST that never saw this component.
 */

/**
 * What a visitor is told after a successful submission.
 *
 * This wording is the one place the page could casually lie, so it is pinned
 * here with the reason attached. No mail provider is configured (user decision,
 * 2026-11-03: collect only, never send), so «已发送确认邮件» or «我们会在 X 天内
 * 回复» would send someone to watch an inbox for a message that is never coming.
 * It restates what Product PM published in 《关于回复，说句实话》 and says
 * nothing beyond it — the same honesty the subscribe form already uses when the
 * mail driver cannot deliver.
 *
 * If a provider is ever wired up, this still must not promise a reply time.
 * That is a commitment about human review capacity, and it is Product PM's to
 * make, not this component's.
 */
const SUCCESS_COPY = {
  title: "已收到，这条异议进了我们的待处理队列。",
  detail:
    "我们现在还没有接通邮件发送，所以不会有自动回执，不用在收件箱里等。" +
    "处理结果会直接体现在对应的记录页上 —— 那才是真正的回复。",
} as const;

type Props = {
  /**
   * Pre-fills 「哪条记录」. The link on a company page passes `slug:impactId`,
   * so somebody arriving from a record does not have to describe which one.
   * Free text and fully editable: it is a hint, and the field accepts
   * 「我不确定是哪一条」 too.
   */
  defaultRecordRef?: string;
};

export function CorrectionForm({ defaultRecordRef }: Props) {
  const pathname = usePathname();
  const [state, formAction, pending] = useActionState<CorrectionFormState, FormData>(
    submitCorrectionRequest,
    null,
  );

  if (state?.status === "ok") {
    return (
      <section
        className="bg-muted/40 max-w-prose rounded-lg border p-6"
        aria-labelledby="correction-done"
      >
        <div role="status" className="max-w-prose space-y-2">
          <p id="correction-done" className="font-medium">
            {SUCCESS_COPY.title}
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">{SUCCESS_COPY.detail}</p>
        </div>
      </section>
    );
  }

  // React 19 resets an uncontrolled form once its action resolves, so a failed
  // attempt comes back as a fresh mount keyed on `attempt` with what they typed
  // as the defaults. Without the key the new defaults would be ignored and the
  // text would be gone. See `CorrectionFormState`.
  const prior = state?.status === "error" ? state.values : null;

  // `max-w-prose` on the card, not just on the fields inside it: the policy
  // text above is one measure wide, and a full-bleed card under it reads as a
  // different page rather than as the thing that text is about.
  return (
    <section
      className="bg-card max-w-prose rounded-xl border p-6"
      aria-labelledby="correction-form-title"
    >
      <h2 id="correction-form-title" className="text-lg font-medium tracking-tight">
        提交异议
      </h2>
      <p className="text-muted-foreground mt-1 max-w-prose text-sm">
        不需要账号，不需要邮箱。标注「可选」的字段留空也能提交成功。
      </p>

      <form
        key={state?.status === "error" ? state.attempt : 0}
        action={formAction}
        className="mt-6 max-w-prose space-y-5"
      >
        <input type="hidden" name="source" value={pathname} />

        <Field
          htmlFor="correction-record-ref"
          label="哪条记录"
          hint="公司名、记录链接，或从记录页点过来时自动带上的标识。不确定是哪一条可以留空。"
          optional
        >
          <Input
            id="correction-record-ref"
            name="recordRef"
            aria-describedby={hintId("correction-record-ref")}
            defaultValue={prior?.recordRef ?? defaultRecordRef ?? ""}
            maxLength={200}
            placeholder="例如：chegg，或留空"
          />
        </Field>

        <Field htmlFor="correction-kind" label="异议类型">
          <Select
            id="correction-kind"
            name="kind"
            defaultValue={prior?.kind || "factual_error"}
            required
          >
            {optionsOf(CORRECTION_KIND).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          htmlFor="correction-body"
          label="你认为哪里不对"
          hint="至少 20 字。写清楚是哪一处、以及你认为正确的说法是什么。"
        >
          <Textarea
            id="correction-body"
            name="body"
            aria-describedby={hintId("correction-body")}
            defaultValue={prior?.body ?? ""}
            required
            minLength={20}
            maxLength={5000}
            rows={7}
            placeholder="例如：这条记录写我们在 2025 年 3 月裁员 40 人，实际是 2025 年 5 月、18 人，公告见……"
          />
        </Field>

        <Field
          htmlFor="correction-source-url"
          label="支持你说法的公开来源链接"
          hint="公司声明、后续报道、财务数据都算。有链接的异议我们能处理得快得多。"
          optional
        >
          <Input
            id="correction-source-url"
            name="sourceUrl"
            type="url"
            aria-describedby={hintId("correction-source-url")}
            defaultValue={prior?.sourceUrl ?? ""}
            maxLength={2000}
            placeholder="https://"
          />
        </Field>

        <Field
          htmlFor="correction-source-quote"
          label="来源里的原文引述"
          hint="逐字摘录，20–2000 字符。填了引述请一并给出上面的链接 —— 这和我们收录一条记录的要求是同一个。"
          optional
        >
          <Textarea
            id="correction-source-quote"
            name="sourceQuote"
            aria-describedby={hintId("correction-source-quote")}
            defaultValue={prior?.sourceQuote ?? ""}
            maxLength={2000}
            rows={4}
          />
        </Field>

        <Field
          htmlFor="correction-email"
          label="邮箱"
          hint="留空也能提交。我们还没有接通邮件发送，接通之后会用它回复这一条异议；在那之前它只是躺在库里。"
          optional
        >
          <Input
            id="correction-email"
            name="email"
            type="email"
            autoComplete="email"
            aria-describedby={hintId("correction-email")}
            defaultValue={prior?.email ?? ""}
            maxLength={254}
            placeholder="you@example.com"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "提交中…" : "提交异议"}
          </Button>
          <p className="text-muted-foreground text-xs">提交后不会收到自动回执。</p>
        </div>

        {state?.status === "error" ? (
          <p role="alert" className="text-destructive text-sm">
            {state.message}
          </p>
        ) : null}
      </form>
    </section>
  );
}

/**
 * Label + hint + control.
 *
 * The hint's id is derived from the control's id (`hintId`) and the call sites
 * pass it to the control's own `aria-describedby`. Explicitly, rather than by
 * `cloneElement`-ing an unknown child: `aria-describedby` has to land on the
 * focusable control — a `<div aria-describedby>` wrapped around an input
 * describes nothing to a screen reader — and a clone that silently stops
 * working when a child becomes a fragment is a worse bargain than six extra
 * attributes.
 */
function hintId(htmlFor: string): string {
  return `${htmlFor}-hint`;
}

function Field({
  htmlFor,
  label,
  hint,
  optional,
  children,
}: {
  htmlFor: string;
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>
        {label}
        {/*
          The word, not an asterisk or a colour. «可选» has to survive being read
          by a screen reader and by someone who cannot distinguish the muted
          grey from the body text, because getting it wrong means a company
          thinks it must give us an address to be heard.
        */}
        {optional ? (
          <span className="text-muted-foreground ml-1.5 text-xs font-normal">（可选）</span>
        ) : null}
      </Label>
      {hint ? (
        <p id={hintId(htmlFor)} className="text-muted-foreground text-xs leading-relaxed">
          {hint}
        </p>
      ) : null}
      {children}
    </div>
  );
}
