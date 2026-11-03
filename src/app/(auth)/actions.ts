"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createSession, destroyCurrentSession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { landingPathFor } from "@/lib/roles";
import { credentialsSchema } from "@/lib/validation";

export type AuthFormState = { error: string } | null;

function readCredentials(formData: FormData) {
  return credentialsSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
}

export async function register(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = readCredentials(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "输入无效" };
  }

  const { email, password } = parsed.data;
  const db = await getDb();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length > 0) {
    return { error: "该邮箱已注册" };
  }

  // No `role` here. The column defaults to the least privileged grade, and
  // leaving it out is the point: there is no code path — not this one, not the
  // billing webhook — that grants write access. See `src/lib/roles.ts`.
  const inserted = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(password) })
    // The unique index is the real guard; the check above only gives a nicer
    // message. Two concurrent signups land here instead of throwing.
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });

  const userId = inserted.at(0)?.id;
  if (!userId) {
    return { error: "该邮箱已注册" };
  }

  await createSession(userId);
  // `/account`, never `/admin`: a new account is a `viewer`, so /admin would
  // turn it straight back around. What registering actually gets you is the
  // account page — the subscription, the export and the API keys (ZCZ-15).
  redirect("/account");
}

export async function login(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = readCredentials(formData);
  if (!parsed.success) {
    return { error: "邮箱或密码不正确" };
  }

  const { email, password } = parsed.data;
  const db = await getDb();

  const rows = await db
    .select({ id: users.id, passwordHash: users.passwordHash, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const user = rows.at(0);
  // Same message for unknown email and wrong password: do not leak which
  // addresses are registered.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { error: "邮箱或密码不正确" };
  }

  await createSession(user.id);
  // Split by role, not by habit: an editor wants the backoffice, and a viewer
  // sent to /admin would be bounced to /account with a refusal — a working
  // login that reads as a broken one.
  redirect(landingPathFor(user.role));
}

export async function logout(): Promise<void> {
  await destroyCurrentSession();
  redirect("/login");
}
