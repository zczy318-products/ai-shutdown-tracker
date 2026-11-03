import type { Metadata } from "next";
import Link from "next/link";

import { CorrectionForm } from "@/components/corrections/correction-form";
import { policyProse } from "@/components/public/policy-prose";

/**
 * 《提出异议或更正》 — the policy, and the form that acts on it.
 *
 * ## The copy is a deliverable, not a draft
 *
 * Every sentence of the policy below was written and signed off by Product PM
 * (ZCZ-16) and is reproduced **verbatim**. Do not reword it. Three sentences in
 * particular are load-bearing promises about how we behave, and softening any
 * of them would make this page a worse commitment than the one we published:
 *
 *  - «不需要注册账号» — enforced by `submitCorrectionRequest`, which reads no
 *    session at all;
 *  - «我们不会仅因为被收录方不满意就撤下一条有据可查的记录；也不会因为我们已经
 *    发布过就拒绝修改» — the standard the pending queue is judged by;
 *  - «我们现在还没有接通邮件发送，所以你不会收到任何自动回执» — true today
 *    (user decision, 2026-11-03: collect only, never send) and the reason the
 *    form's success state promises nothing.
 *
 * ## Anonymous, and no truncation
 *
 * No session read, no paywall, no «注册后可见». The `?record=` parameter only
 * pre-fills a free-text field — it is never looked up, so the page cannot be
 * used to probe which record ids exist. See the `record_ref` note in
 * `src/db/schema.ts`.
 */

/** Same reason as `/methodology` — see the note there. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "提出异议或更正 — Rest In Prompts",
  description:
    "这份名单上的每一家都是真实公司。任何人都可以指出一条记录的事实错误、来源问题或归因异议，不需要注册账号。",
};

/**
 * `?record=` is a hint for the form field, nothing more. Clamped to the column
 * length and stripped of control characters — it is attacker-controlled input
 * that gets rendered into a value attribute and may be stored, and the shape it
 * is allowed to have should not depend on React's escaping alone.
 */
function recordRefFrom(raw: string | string[] | undefined): string | undefined {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value) return undefined;
  return value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200) || undefined;
}

export default async function CorrectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const defaultRecordRef = recordRefFrom(params.record);

  return (
    <div className="space-y-12">
      <article className={policyProse}>
        <h1 className="text-3xl font-semibold tracking-tight">提出异议或更正</h1>

        <p>这份名单上的每一家都是真实公司。所以这一页必须存在。</p>

        <h2>谁可以提</h2>
        <p>
          任何人。被收录的公司及其员工、记者、研究者、或者只是发现了一处错误的读者。
          <strong>不需要注册账号。</strong>
        </p>

        <h2>可以提什么</h2>
        <ul>
          <li>事实错误（公司名、日期、人数、事件本身）；</li>
          <li>来源问题（链接失效、引述与原文不符、来源被撤稿或更正过）；</li>
          <li>
            <strong>归因异议</strong> —— 你认为这件事与 AI 无关，或原因另有其他；
          </li>
          <li>需要补充的反方证据（公司声明、后续报道、财务数据）；</li>
          <li>事情已经变化（裁员计划被撤回、公司恢复运营）。</li>
        </ul>

        <h2>我们会怎么处理</h2>
        <p>
          按<Link href="/methodology">我们怎么判断一条记录</Link>里的同一套标准，结果只有四种：
        </p>
        <ol>
          <li>
            <strong>更正</strong> —— 事实有误，直接改；
          </li>
          <li>
            <strong>下调置信度</strong> —— 证据撑不起当前档位；
          </li>
          <li>
            <strong>补入反方证据</strong> —— 你的说法与现有来源并存，双方说法同时展示；
          </li>
          <li>
            <strong>撤下记录</strong> —— 达不到收录门槛。
          </li>
        </ol>
        <p>
          我们<strong>不会</strong>仅因为被收录方不满意就撤下一条有据可查的记录；也
          <strong>不会</strong>因为我们已经发布过就拒绝修改。判据是证据，不是立场。
        </p>

        <h2>请提供什么</h2>
        <p>
          哪条记录、你认为哪里不对、以及<strong>能支持你说法的公开来源</strong>
          （如果有）。有链接和原文引述的异议，我们能处理得快得多 ——
          这和我们收录一条记录的要求是同一个。
        </p>

        <h2>关于回复，说句实话</h2>
        <p>
          <strong>
            我们现在还没有接通邮件发送，所以你不会收到任何自动回执，也不用在收件箱里等。
          </strong>
          提交会进入我们的待处理队列。处理结果会直接体现在对应的记录页上 —— 那才是真正的回复。
        </p>
        <p>
          留邮箱是可选的。接通邮件之后，我们会用它回复这一条异议；在那之前它只是躺在库里。
        </p>
      </article>

      <CorrectionForm defaultRecordRef={defaultRecordRef} />
    </div>
  );
}
