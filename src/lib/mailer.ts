/**
 * The one place that sends email, and the one place that decides whether we are
 * able to send email at all.
 *
 * **There is exactly one driver, `log`, and that is the finished state of this
 * module** — not a placeholder waiting on credentials. The product decision
 * (2026-11-03) was to collect subscriptions and not send anything: no provider,
 * no provider SDK, no provider environment variable, no third-party account.
 * So `log` writes the message to the server log and reports `delivered: false`.
 *
 * That `false` is the important part. A `log` driver that returned success would
 * make every caller — and therefore every page — tell a visitor "check your
 * inbox" about a message that does not exist. They would wait for it, conclude
 * the site is broken, and be right. Returning "not delivered" is what lets
 * `src/app/subscribe` render honest copy instead, and what keeps
 * `/admin/subscribers` honest about why every row says «待确认».
 *
 * If a provider is ever authorized, the shape of the change is: add a second
 * factory beside `createLogMailer`, pick between them in `resolveMailer`, and
 * obey two rules while doing it —
 *
 *  - map a non-2xx provider response to `delivered: false`, do not throw it
 *    away; everything downstream reads that flag to decide what to promise a
 *    human;
 *  - send *outside* the request (queue, `after()`), because a provider
 *    round-trip only happens on some branches of the subscribe action and a
 *    visible latency difference reintroduces the email enumeration oracle the
 *    response wording was written to close.
 */

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

/**
 * Development / unwired driver: log the message, report it undelivered.
 *
 * The body is logged in full, confirm link included, because that link is the
 * only way to exercise double opt-in without a provider. That is acceptable
 * precisely *because* this driver is never a production sending path: if a
 * deployment is running on `log`, no link has been mailed to anyone, so the one
 * in the log is not a credential anybody else is holding. A real provider
 * adapter must not log bodies.
 */
function createLogMailer(): Mailer {
  return {
    driver: "log",
    canDeliver: false,
    async send(message) {
      console.info(
        [
          "[mailer:log] NOT DELIVERED — no email provider is configured.",
          `  to:      ${message.to}`,
          `  subject: ${message.subject}`,
          "  body:",
          message.text ?? message.html,
        ].join("\n"),
      );
      return {
        delivered: false,
        driver: "log",
        detail: "no email provider is wired up; nothing was sent",
      };
    },
  };
}

/**
 * Takes no configuration, on purpose.
 *
 * An env var that selects a provider would be a switch with one position, and
 * the day somebody set it to `resend` they would get the log driver and a site
 * that had not changed — the worst outcome of the three. There is nothing to
 * configure until a provider is actually authorized and written.
 */
export function resolveMailer(): Mailer {
  return createLogMailer();
}

const globalForMailer = globalThis as typeof globalThis & { __aistMailer?: Mailer };

/** Cached like the db handle, for the same hot-reload reason. */
export function getMailer(): Mailer {
  globalForMailer.__aistMailer ??= resolveMailer();
  return globalForMailer.__aistMailer;
}
