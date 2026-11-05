"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { getDb } from "@/db";
import { users } from "@/db/schema";
import { createSession, destroyCurrentSession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { credentialsSchema } from "@/lib/validation";
import { consumeAuthBudget } from "@/lib/auth-rate-limit";
import { clientAddress } from "@/lib/client-ip";
import { isAdmin } from "@/lib/authorization";

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
  if (!(await consumeAuthBudget(email, clientAddress(await headers())))) {
    return { error: "尝试过于频繁，请稍后再试。" };
  }
  const db = await getDb();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length > 0) {
    return { error: "该邮箱已注册" };
  }

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
  if (!(await consumeAuthBudget(email, clientAddress(await headers())))) {
    return { error: "尝试过于频繁，请稍后再试。" };
  }
  const db = await getDb();

  const rows = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const user = rows.at(0);
  // Same message for unknown email and wrong password: do not leak which
  // addresses are registered.
  const matches = user
    ? await verifyPassword(password, user.passwordHash)
    : (await hashPassword(password), false);
  if (!user || !matches) {
    return { error: "邮箱或密码不正确" };
  }

  await createSession(user.id);
  redirect(isAdmin(user) ? "/admin" : "/account");
}

export async function logout(): Promise<void> {
  await destroyCurrentSession();
  redirect("/login");
}
