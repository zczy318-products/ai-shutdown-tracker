import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { subscribeThrottle } from "@/db/schema";

/** Durable counters share the existing throttle table, with disjoint hashed namespaces. */
export async function consumeAuthBudget(email: string, address: string): Promise<boolean> {
  const db = await getDb();
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const budgets = [
    { scope: "ip", key: address, limit: 30 },
    { scope: "email", key: email, limit: 10 },
  ] as const;
  for (const budget of budgets) {
    const keyHash = createHash("sha256").update(`auth:${budget.scope}:${budget.key}`).digest("hex");
    const [row] = await db.insert(subscribeThrottle)
      .values({ scope: budget.scope, keyHash, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [subscribeThrottle.scope, subscribeThrottle.keyHash, subscribeThrottle.windowStart],
        set: { count: sql`${subscribeThrottle.count} + 1` },
      }).returning({ count: subscribeThrottle.count });
    // A blocked client must not create unbounded rows by rotating email input.
    if (!row || row.count > budget.limit) return false;
    if (row?.count === 1) {
      await db.delete(subscribeThrottle).where(lt(subscribeThrottle.windowStart, new Date(now - 2 * 60 * 60 * 1000)));
    }
  }
  return true;
}
