/** Email delivery is disabled. Logs redact recipients and tokens by default. */

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative. Spam filters weigh HTML-only mail badly. */
  text?: string;
};

export type MailDriverName = "log" | (string & {});

export type MailResult = {
  /**
   * `true` only when a provider accepted the message. Never set optimistically:
   * callers use it to decide what to promise a human.
   */
  delivered: boolean;
  driver: MailDriverName;
  /** Provider message id, or the reason it was not delivered. */
  detail?: string;
};

export type Mailer = {
  readonly driver: MailDriverName;
  /**
   * Whether this driver can deliver at all, known *before* sending.
   *
   * The subscribe form keys its wording off this rather than off a `MailResult`,
   * because the result depends on which branch the submission took (a
   * re-submission of an already-confirmed address sends nothing) and the wording
   * must not. See `src/app/subscribe/actions.ts`.
   */
  readonly canDeliver: boolean;
  send(message: MailMessage): Promise<MailResult>;
};

/** Content logging is an explicit local-only test facility, never a deployment default. */
function createLogMailer(): Mailer {
  return {
    driver: "log",
    canDeliver: false,
    async send(message) {
      if (process.env.MAIL_LOG_CONTENT === "true" && process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
        console.info([
          "[mailer:log] NOT DELIVERED — local test content logging enabled.",
          `  to:      ${message.to}`,
          `  subject: ${message.subject}`,
          "  body:",
          message.text ?? message.html,
        ].join("\n"));
      } else {
        console.info("[mailer:log] NOT DELIVERED — recipient and message redacted.");
      }
      return {
        delivered: false,
        driver: "log",
        detail: "no email provider is wired up; nothing was sent",
      };
    },
  };
}

export function resolveMailer(): Mailer {
  return createLogMailer();
}

const globalForMailer = globalThis as typeof globalThis & { __aistMailer?: Mailer };

/** Cached like the db handle, for the same hot-reload reason. */
export function getMailer(): Mailer {
  globalForMailer.__aistMailer ??= resolveMailer();
  return globalForMailer.__aistMailer;
}
