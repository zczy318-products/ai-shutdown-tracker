"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiKeyError, createApiKey, revokeApiKey } from "@/lib/api-keys";
import { getCurrentUser } from "@/lib/auth";

/**
 * API key management.
 *
 * `createApiKey` returns the plaintext token once and it is never recoverable
 * afterwards, so the state here carries it back to the page for a single
 * render. That is the only moment it exists outside the caller's clipboard.
 */

export type ApiKeyFormState =
  | { error: string }
  | { ok: true; token: string; name: string }
  | { ok: true; message: string }
  | null;

export async function issueApiKey(
  _prev: ApiKeyFormState,
  formData: FormData,
): Promise<ApiKeyFormState> {
  // A server action is its own endpoint; the page's gate does not cover it.
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  try {
    const { token, row } = await createApiKey(user, String(formData.get("name") ?? ""));
    revalidatePath("/account");
    return { ok: true, token, name: row.name };
  } catch (error) {
    if (error instanceof ApiKeyError) return { error: error.message };
    console.error("[api-keys] issue failed");
    return { error: "生成 API key 失败，请稍后重试。" };
  }
}

export async function revokeApiKeyAction(
  _prev: ApiKeyFormState,
  formData: FormData,
): Promise<ApiKeyFormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const keyId = String(formData.get("keyId") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(keyId)) {
    return { error: "key id 无效。" };
  }

  const revoked = await revokeApiKey(user.id, keyId);
  if (!revoked) {
    return { error: "这个 key 不存在、不属于当前账号，或已经被吊销过了。" };
  }

  revalidatePath("/account");
  return { ok: true, message: "已吊销。该 key 的后续调用会立即返回 401。" };
}
