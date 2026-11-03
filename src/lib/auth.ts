import { createHash, randomBytes } from "node:crypto";

import { eq, lt } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb } from "@/db";
import { sessions, users, type User } from "@/db/schema";

/**
 * Session handling for the admin backoffice.
 *
 * Deliberately hand-rolled rather than Auth.js/better-auth: the only factor is
 * email+password, the session store is the same Drizzle handle the rest of the
 * app uses, and this keeps one less framework between us and the PGlite /
 * hosted-Postgres switch. Revisit if we add OAuth providers.
 */

export const SESSION_COOKIE = "aist_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** The cookie carries the raw token; only its digest is persisted. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<void> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** Returns the signed-in user, or null. Expired rows are cleaned up on read. */
export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  const id = hashToken(token);

  const rows = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);

  const row = rows.at(0);
  if (!row) return null;

  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  return row.user;
}

export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    const db = await getDb();
    await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
  }

  store.delete(SESSION_COOKIE);
}

/** Opportunistic sweep; safe to call from anywhere. */
export async function deleteExpiredSessions(): Promise<void> {
  const db = await getDb();
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
