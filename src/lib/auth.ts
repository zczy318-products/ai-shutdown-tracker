import { createHash, randomBytes } from "node:crypto";

import { eq, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { ROLE_DENIED_PATH, isEditor } from "@/lib/roles";

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

/**
 * The gate every protected page has to call **itself**, in its own body, before
 * it reads anything.
 *
 * A layout's `redirect()` is not enough on its own. Next renders a layout and
 * the page under it concurrently, so an anonymous request to
 * `/admin/subscribers` still ran the subscriber query — and the dev server put
 * the rendered result, every email address included, into the body of the 307
 * that was supposed to be turning the visitor away. `npm run verify:subscribe`
 * asserts that body no longer contains an address.
 *
 * Calling this first is what closes it, because the data is never fetched: the
 * redirect is thrown before the queries start, not raced against them.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * The gate for every page under `/admin` and for everything that writes
 * (ZCZ-15). Semantics: «a valid session **and** a role allowed to write».
 *
 * `requireUser()` was never that gate: `/register` is open to anyone, so "has
 * a valid session" is a fact about a stranger, not a permission. Every caller
 * that used to settle for a session now has to pass this instead — the four
 * `/admin` pages that read data, the one that only renders the editor form,
 * the layout, and the five server actions in
 * `src/app/admin/records/actions.ts`, which are public HTTP endpoints that no
 * page gate covers.
 *
 * Call it in the page's own body, first, for the same reason `requireUser`
 * gives: the role check races concurrent layout rendering exactly the way the
 * session check did, so a layout-only gate would re-open the leak PR #3
 * closed.
 *
 * Two different refusals, on purpose:
 *
 *  - no session → `/login`, where signing in is the thing to do;
 *  - a session whose role may not write → `/account?denied=admin`, **not**
 *    `/login`. They are already signed in, so a login page would bounce them
 *    back to a page they still cannot see and explain nothing. `/account`
 *    renders the reason.
 */
export async function requireEditor(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isEditor(user.role)) redirect(ROLE_DENIED_PATH);
  return user;
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
