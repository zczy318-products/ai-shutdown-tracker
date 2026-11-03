import type { MailMessage } from "@/lib/mailer";

/**
 * The confirmation email. The only message this task sends.
 *
 * No marketing copy, no "news you'll love", no tracking pixel: it exists to
 * carry one link and to let someone who did not ask for it get out in one
 * click. The unsubscribe link is in the confirmation mail too — if a stranger
 * typed your address, the mail you receive should already contain the way out.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function confirmSubscriptionEmail(input: {
  email: string;
  confirmUrl: string;
  unsubscribeUrl: string;
}): MailMessage {
  const confirm = escapeHtml(input.confirmUrl);
  const unsub = escapeHtml(input.unsubscribeUrl);

  const text = [
    "确认订阅 Rest In Prompts",
    "",
    `有人用这个邮箱（${input.email}）订阅了 Rest In Prompts 的新增记录通知。`,
    "如果是你，请打开下面的链接完成确认（7 天内有效）：",
    input.confirmUrl,
    "",
    "如果不是你，不用做任何事——没有确认的邮箱不会收到任何通知。",
    "也可以直接退订，一步生效，不需要登录：",
    input.unsubscribeUrl,
  ].join("\n");

  const html = `<!doctype html>
<html lang="zh-Hans">
  <body style="font-family: system-ui, sans-serif; line-height: 1.6; color: #111;">
    <h1 style="font-size: 18px;">确认订阅 Rest In Prompts</h1>
    <p>有人用这个邮箱（${escapeHtml(input.email)}）订阅了 Rest In Prompts 的新增记录通知。</p>
    <p>如果是你，请点击下面的链接完成确认（7 天内有效）：</p>
    <p><a href="${confirm}">${confirm}</a></p>
    <p>如果不是你，不用做任何事——没有确认的邮箱不会收到任何通知。</p>
    <p>也可以直接退订，一步生效，不需要登录：<a href="${unsub}">退订</a></p>
  </body>
</html>`;

  return { to: input.email, subject: "确认订阅 Rest In Prompts", html, text };
}
