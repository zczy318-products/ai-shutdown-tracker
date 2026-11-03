/**
 * The one place that sends email, and the one place that decides whether we are
 * able to send email at all.
 *
 * There is **no email provider wired up yet** — nobody has credentials, and
 * registering one needs an authorization card from the user (T10 / ZCZ-11:
 * "不注册任何第三方账号"). So the default driver is `log`, which writes the
 * message to the server log and reports `delivered: false`.
 *
 * That `false` is the important part of this module. A `log` driver that
 * returned success would make every caller — and therefore every page — tell a
 * visitor "check your inbox" about a message that does not exist. They would
 * wait for it, conclude the site is broken, and be right. Returning "not
 * delivered" is what lets `src/app/subscribe` render honest copy instead.
 *
 * Wiring a provider later means adding one entry to `PROVIDER_ADAPTERS` below.
 * Nothing else in the app looks at `MAIL_*`.
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

/** `From:` header. Only meaningful once a provider is wired. */
export function mailFrom(env: NodeJS.ProcessEnv = process.env): string {
  return env.MAIL_FROM?.trim() || "Rest In Prompts <no-reply@localhost>";
}

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
        detail: "no email provider configured (MAIL_PROVIDER unset)",
      };
    },
  };
}

/**
 * Provider adapters, by `MAIL_PROVIDER` value. Empty on purpose.
 *
 * To add one (after the user has authorized the account):
 *
 *   resend: (env) => ({
 *     driver: "resend",
 *     canDeliver: true,
 *     async send(message) { ...; return { delivered: res.ok, ... } },
 *   }),
 *
 * Two rules for whoever writes the first one:
 *
 *  - map a non-2xx response to `delivered: false`, do not throw it away;
 *  - send *outside* the request if you can (queue, `after()`), because a
 *    provider round-trip only happens on some branches of the subscribe action
 *    and a visible latency difference reintroduces the email enumeration oracle
 *    the response wording was written to close.
 */
const PROVIDER_ADAPTERS: Record<string, (env: NodeJS.ProcessEnv) => Mailer> = {};

export function resolveMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  const requested = env.MAIL_PROVIDER?.trim();
  if (!requested || requested === "log") return createLogMailer();

  const adapter = PROVIDER_ADAPTERS[requested];
  if (!adapter) {
    // Falling back rather than throwing: a typo in an env var should not take
    // the site down. Loud, because the alternative is silence about mail that
    // is not going out.
    console.error(
      `[mailer] MAIL_PROVIDER="${requested}" has no adapter in src/lib/mailer.ts; ` +
        "falling back to the log driver. No email is being delivered.",
    );
    return createLogMailer();
  }
  return adapter(env);
}

const globalForMailer = globalThis as typeof globalThis & { __aistMailer?: Mailer };

/** Cached like the db handle, for the same hot-reload reason. */
export function getMailer(): Mailer {
  globalForMailer.__aistMailer ??= resolveMailer();
  return globalForMailer.__aistMailer;
}
