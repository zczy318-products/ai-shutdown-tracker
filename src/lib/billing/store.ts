import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db";
import { billingEvents, users, type BillingEvent, type User } from "@/db/schema";
import type { Plan, PlanSource } from "@/lib/plans";

/**
 * Every plan change in the system goes through `applyPlanChange`.
 *
 * Centralised for one reason: the plan column decides who can take the whole
 * dataset away, so there should be exactly one place to read when asking "how
 * did this account become pro?". The `billing_events` row written alongside it
 * answers that, including for the simulated upgrades, which are the ones most
 * likely to be mistaken for revenue later.
 */

export type PlanChange = {
  userId: string;
  plan: Plan;
  source: PlanSource;
  /** Stripe `evt_…`, or a locally minted id for a simulated change. */
  externalId: string;
  type: string;
  note?: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
};

export type PlanChangeResult =
  | { applied: true; plan: Plan }
  | { applied: false; reason: "duplicate" | "unknown_user" };

/**
 * Applies a plan change, exactly once per `externalId`.
 *
 * The ledger insert goes *first* and uses `onConflictDoNothing`: if it inserts
 * nothing, this event has already been handled and the function returns
 * without touching the user row. Stripe retries deliveries by design, and a
 * `customer.subscription.deleted` replayed after a later re-subscribe would
 * otherwise silently downgrade a paying account.
 */
export async function applyPlanChange(change: PlanChange): Promise<PlanChangeResult> {
  const db = await getDb();
  const now = new Date();

  return db.transaction(async (tx) => {
    const ledger = await tx
      .insert(billingEvents)
      .values({
        userId: change.userId,
        externalId: change.externalId,
        type: change.type,
        planAfter: change.plan,
        source: change.source,
        note: change.note,
      })
      .onConflictDoNothing({ target: billingEvents.externalId })
      .returning({ id: billingEvents.id });

    if (ledger.length === 0) {
      return { applied: false, reason: "duplicate" } as const;
    }

    const updated = await tx
      .update(users)
      .set({
        plan: change.plan,
        planSource: change.source,
        planUpdatedAt: now,
        updatedAt: now,
        ...(change.stripeCustomerId !== undefined
          ? { stripeCustomerId: change.stripeCustomerId }
          : {}),
        ...(change.stripeSubscriptionId !== undefined
          ? { stripeSubscriptionId: change.stripeSubscriptionId }
          : {}),
      })
      .where(eq(users.id, change.userId))
      .returning({ id: users.id });

    if (updated.length === 0) {
      // Roll the ledger row back with it: recording a plan change against an
      // account that does not exist would be a lie in the audit trail.
      throw new UnknownUserError(change.userId);
    }

    return { applied: true, plan: change.plan } as const;
  }).catch((error) => {
    if (error instanceof UnknownUserError) {
      return { applied: false, reason: "unknown_user" } as const;
    }
    throw error;
  });
}

class UnknownUserError extends Error {
  constructor(userId: string) {
    super(`no user ${userId}`);
    this.name = "UnknownUserError";
  }
}

export async function findUserByStripeCustomerId(customerId: string): Promise<User | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.stripeCustomerId, customerId))
    .limit(1);
  return rows.at(0) ?? null;
}

export async function findUserById(userId: string): Promise<User | null> {
  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows.at(0) ?? null;
}

/** The account page shows this so a demo upgrade is traceable after the fact. */
export async function recentBillingEvents(userId: string, limit = 5): Promise<BillingEvent[]> {
  const db = await getDb();
  return db
    .select()
    .from(billingEvents)
    .where(eq(billingEvents.userId, userId))
    .orderBy(desc(billingEvents.createdAt))
    .limit(limit);
}
