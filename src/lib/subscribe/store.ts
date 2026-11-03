import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, lt, ne, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { subscribeThrottle, subscriber } from "@/db/schema";

/**
 * Every read and write of the subscription tables.
 *
 * Three rules this module exists to keep in one place:
 *
 *  1. Raw tokens never touch the database — only SHA-256 digests, same as
 *     `sessions` in `src/lib/auth.ts`.
 *  2. A confirm token is spendable exactly once. That is not enforced by
 *     "remember to clear it afterwards" but by a single UPDATE that matches on
 *     the digest and nulls it in the same statement, so a replay matches zero
 *     rows even if two requests race.
 *  3. `listMailableSubscribers` is the only way to get addresses to send to.
 *     Nothing else in the codebase should ever `select ... from subscriber`.
 */

/** Seven days, per the task brief. Long enough for a mail that sat unread. */
const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Throttle budgets for the public form. Both windows are fixed and one hour
 * long; see the `subscribe_throttle` comment in the schema for why the counters
 * live in the database.
 *
 * The IP budget is the loose one: a household, an office or a university NAT
 * all share an address, and locking out a whole building to stop one script is
 * the wrong trade. The email budget is tight, because three confirmation mails
 * to one address in an hour is already more than anybody needs — and it is the
 * budget that stops this form being used to flood somebody else's inbox.
 */
export const SUBSCRIBE_RATE_LIMITS = {
  ip: { limit: 10, windowMs: 60 * 60 * 1000 },
  email: { limit: 3, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, { limit: number; windowMs: number }>;

export type ThrottleScope = keyof typeof SUBSCRIBE_RATE_LIMITS;

const LONGEST_WINDOW_MS = Math.max(
  ...Object.values(SUBSCRIBE_RATE_LIMITS).map((limit) => limit.windowMs),
);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 256 bits of urandom. Guessing one is not a threat model worth modelling. */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/**
 * Counts one attempt against `scope`/`key` and says whether it is within
 * budget.
 *
 * One statement: `insert … on conflict do update set count = count + 1
 * returning count`. The increment and the read are the same row lock, so
 * concurrent submissions cannot both see "9" and both proceed.
 *
 * `key` is hashed before it is stored — the table has to count attempts for
 * addresses that never subscribe, and it should not accumulate a plaintext list
 * of them.
 */
export async function consumeRateLimit(scope: ThrottleScope, key: string): Promise<boolean> {
  const { limit, windowMs } = SUBSCRIBE_RATE_LIMITS[scope];
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);

  const db = await getDb();
  const rows = await db
    .insert(subscribeThrottle)
    .values({ scope, keyHash: sha256(key), windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [subscribeThrottle.scope, subscribeThrottle.keyHash, subscribeThrottle.windowStart],
      set: { count: sql`${subscribeThrottle.count} + 1` },
    })
    .returning({ count: subscribeThrottle.count });

  const count = rows.at(0)?.count ?? 1;

  // Opportunistic prune, only when this call opened a new window — that caps it
  // at once per key per window instead of once per request.
  //
  // The cutoff uses the *longest* window of any scope, not this scope's. The
  // table is shared, so pruning on a one-hour window would silently reset the
  // counters of a scope with a longer one the day somebody adds it.
  if (count === 1) {
    await db
      .delete(subscribeThrottle)
      .where(lt(subscribeThrottle.windowStart, new Date(now - 2 * LONGEST_WINDOW_MS)));
  }

  return count <= limit;
}

// ---------------------------------------------------------------------------
// Subscribe
// ---------------------------------------------------------------------------

export type SubscribeRequest =
  /** A `pending` row exists and this confirm token should be mailed. */
  | { kind: "confirm_pending"; confirmToken: string; unsubToken: string }
  /** The address was already confirmed. Nothing was changed, nothing is mailed. */
  | { kind: "already_confirmed" };

/**
 * Registers an intent to subscribe. Callers must treat every return value as
 * the same outcome in anything a visitor can observe — see the enumeration note
 * in `src/app/subscribe/actions.ts`.
 *
 * New address, `pending` address and previously `unsubscribed` address all end
 * up `pending` with a freshly minted pair of tokens. Re-subscribing after an
 * unsubscribe is explicitly allowed, and it goes through double opt-in again:
 * the earlier confirmation said nothing about today.
 *
 * `setWhere` is what protects a confirmed subscriber. Without it, anyone could
 * type a stranger's address and knock their live subscription back to pending.
 */
export async function requestSubscription(input: {
  email: string;
  source: string;
}): Promise<SubscribeRequest> {
  const confirmToken = newToken();
  const unsubToken = newToken();
  const expiresAt = new Date(Date.now() + CONFIRM_TTL_MS);
  const db = await getDb();

  const rows = await db
    .insert(subscriber)
    .values({
      email: input.email,
      status: "pending",
      confirmTokenHash: sha256(confirmToken),
      confirmTokenExpiresAt: expiresAt,
      unsubTokenHash: sha256(unsubToken),
      source: input.source,
    })
    .onConflictDoUpdate({
      target: subscriber.email,
      set: {
        status: "pending",
        confirmTokenHash: sha256(confirmToken),
        confirmTokenExpiresAt: expiresAt,
        // Rotated too: the old unsubscribe link belongs to a cycle that ended.
        unsubTokenHash: sha256(unsubToken),
        source: input.source,
        confirmedAt: null,
        unsubscribedAt: null,
      },
      setWhere: ne(subscriber.status, "confirmed"),
    })
    .returning({ id: subscriber.id });

  // Zero rows means `setWhere` rejected the update, i.e. the row is confirmed.
  return rows.length > 0
    ? { kind: "confirm_pending", confirmToken, unsubToken }
    : { kind: "already_confirmed" };
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

export type ConfirmResult =
  | { kind: "confirmed"; email: string }
  | { kind: "expired" }
  | { kind: "invalid" };

/**
 * Spends a confirm token.
 *
 * The UPDATE both matches the digest and clears it, which is the whole
 * one-time-use guarantee: a second click, a mail client prefetching the link,
 * or two tabs racing all find nothing left to match.
 *
 * `expired` is reported separately from `invalid` only so the page can tell
 * someone to subscribe again instead of leaving them staring at "invalid". It
 * leaks nothing: whoever is holding the token already has it.
 */
export async function confirmSubscription(token: string): Promise<ConfirmResult> {
  if (!token) return { kind: "invalid" };

  const db = await getDb();
  const tokenHash = sha256(token);
  const now = new Date();

  const rows = await db
    .update(subscriber)
    .set({
      status: "confirmed",
      confirmedAt: now,
      unsubscribedAt: null,
      confirmTokenHash: null,
      confirmTokenExpiresAt: null,
    })
    .where(
      and(
        eq(subscriber.confirmTokenHash, tokenHash),
        gt(subscriber.confirmTokenExpiresAt, now),
      ),
    )
    .returning({ email: subscriber.email });

  const row = rows.at(0);
  if (row) return { kind: "confirmed", email: row.email };

  // No match: either the digest is unknown (already spent, or never existed) or
  // it is a real token past its expiry.
  const stale = await db
    .select({ id: subscriber.id })
    .from(subscriber)
    .where(eq(subscriber.confirmTokenHash, tokenHash))
    .limit(1);

  return stale.length > 0 ? { kind: "expired" } : { kind: "invalid" };
}

// ---------------------------------------------------------------------------
// Unsubscribe
// ---------------------------------------------------------------------------

export type UnsubscribeResult = { kind: "unsubscribed" } | { kind: "invalid" };

/**
 * One step, no session, no confirmation screen to click through.
 *
 * Idempotent on purpose. The unsubscribe token is *not* cleared, so the link in
 * a two-year-old email keeps working, and a link checker that fetched it before
 * the human did does not leave them with an error page. `coalesce` keeps the
 * first unsubscribe time rather than overwriting it on every later click.
 *
 * Any pending confirm token is dropped at the same time: somebody who clicks
 * unsubscribe out of a confirmation mail has answered the question.
 */
export async function unsubscribeByToken(token: string): Promise<UnsubscribeResult> {
  if (!token) return { kind: "invalid" };

  const db = await getDb();
  const rows = await db
    .update(subscriber)
    .set({
      status: "unsubscribed",
      unsubscribedAt: sql`coalesce(${subscriber.unsubscribedAt}, now())`,
      confirmTokenHash: null,
      confirmTokenExpiresAt: null,
    })
    .where(eq(subscriber.unsubTokenHash, sha256(token)))
    .returning({ id: subscriber.id });

  return rows.length > 0 ? { kind: "unsubscribed" } : { kind: "invalid" };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * The only query that may feed an outgoing mail job.
 *
 * `status = 'confirmed'` is inside the query rather than left to the caller, so
 * a future digest job cannot forget it: `pending` never asked for mail and
 * `unsubscribed` asked to stop, and both of those are the same bug from the
 * recipient's side. Do not add an `includeUnconfirmed` parameter.
 */
export async function listMailableSubscribers(): Promise<{ id: string; email: string }[]> {
  const db = await getDb();
  return db
    .select({ id: subscriber.id, email: subscriber.email })
    .from(subscriber)
    .where(eq(subscriber.status, "confirmed"));
}
