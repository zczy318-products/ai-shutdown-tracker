import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db";
import { apiKeys, users, type ApiKey, type User } from "@/db/schema";
import { can, type Plan } from "@/lib/plans";

/**
 * Issuing, listing, revoking and authenticating API keys.
 *
 * Storage follows `src/lib/auth.ts`: the database holds SHA-256 of the key,
 * never the key. A plain digest rather than scrypt is the right call *here* —
 * unlike a password, the key is 256 bits of CSPRNG output, so there is no
 * dictionary to attack and a slow KDF would only add latency to every API
 * request.
 *
 * Authentication checks the plan on every call rather than at issue time. A
 * key issued while an account was pro must stop working when the subscription
 * ends, otherwise "cancel" would not actually cancel anything.
 */

/** `rip` = Rest In Prompts. The `_test` segment is deliberate: nothing in this
 *  project is production billing, and a leaked key should say so on sight. */
const KEY_PREFIX = "rip_test_";
const PREFIX_DISPLAY_LENGTH = 16;
const MAX_ACTIVE_KEYS = 5;

function hashKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type IssuedKey = {
  row: ApiKey;
  /** The only time the plaintext key exists. Show it once, then forget it. */
  token: string;
};

export class ApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyError";
  }
}

export async function listApiKeys(userId: string): Promise<ApiKey[]> {
  const db = await getDb();
  return db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(desc(apiKeys.createdAt));
}

export async function createApiKey(user: User, name: string): Promise<IssuedKey> {
  if (!can(user.plan as Plan, "apiKeys")) {
    throw new ApiKeyError("当前套餐不包含 API key。升级到专业版后即可生成。");
  }

  const label = name.trim();
  if (!label) throw new ApiKeyError("请给这个 key 起一个名字，方便之后认出它。");
  if (label.length > 80) throw new ApiKeyError("名字过长（最多 80 字符）。");

  const active = await listActiveKeys(user.id);
  if (active.length >= MAX_ACTIVE_KEYS) {
    throw new ApiKeyError(
      `每个账号最多同时持有 ${MAX_ACTIVE_KEYS} 个有效 key。请先吊销一个不用的。`,
    );
  }

  const token = KEY_PREFIX + randomBytes(32).toString("base64url");
  const db = await getDb();
  const [row] = await db
    .insert(apiKeys)
    .values({
      userId: user.id,
      name: label,
      tokenHash: hashKey(token),
      tokenPrefix: token.slice(0, PREFIX_DISPLAY_LENGTH),
    })
    .returning();

  return { row, token };
}

async function listActiveKeys(userId: string): Promise<ApiKey[]> {
  const db = await getDb();
  return db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
}

/**
 * Scoped to the owner: the id comes from a form field, so without the
 * `userId` predicate anyone could revoke anyone else's key by guessing a uuid.
 */
export async function revokeApiKey(userId: string, keyId: string): Promise<boolean> {
  const db = await getDb();
  const revoked = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  return revoked.length > 0;
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export type ApiAuthFailure = {
  /** HTTP status the route should answer with. */
  status: 401 | 402;
  code: "missing_key" | "invalid_key" | "revoked_key" | "plan_required";
  messageZh: string;
};

export type ApiAuthResult =
  | { ok: true; user: User; key: ApiKey }
  | { ok: false; failure: ApiAuthFailure };

/** `Authorization: Bearer <key>`, or `X-API-Key: <key>` for curl convenience. */
export function readApiKeyFromHeaders(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (authorization) {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const direct = headers.get("x-api-key");
  return direct ? direct.trim() : null;
}

/**
 * Resolves a key to its owner.
 *
 * A revoked key is reported distinctly from an unknown one. That leaks
 * nothing — the caller already held the key — and it turns the most common
 * support question ("why did my script stop working?") into a self-service
 * answer.
 */
export async function authenticateApiKey(token: string | null): Promise<ApiAuthResult> {
  if (!token) {
    return {
      ok: false,
      failure: {
        status: 401,
        code: "missing_key",
        messageZh: "缺少 API key。请在 Authorization: Bearer <key> 或 X-API-Key 头中带上。",
      },
    };
  }

  const db = await getDb();
  const rows = await db
    .select({ key: apiKeys, user: users })
    .from(apiKeys)
    .innerJoin(users, eq(apiKeys.userId, users.id))
    .where(eq(apiKeys.tokenHash, hashKey(token)))
    .limit(1);

  const row = rows.at(0);
  if (!row) {
    return {
      ok: false,
      failure: { status: 401, code: "invalid_key", messageZh: "API key 无效。" },
    };
  }

  if (row.key.revokedAt) {
    return {
      ok: false,
      failure: {
        status: 401,
        code: "revoked_key",
        messageZh: `该 API key 已于 ${row.key.revokedAt.toISOString()} 吊销，不再可用。`,
      },
    };
  }

  if (!can(row.user.plan as Plan, "apiKeys")) {
    return {
      ok: false,
      failure: {
        status: 402,
        code: "plan_required",
        messageZh: "该账号当前不是专业版，API 访问已暂停。恢复订阅后 key 会自动重新生效。",
      },
    };
  }

  // Fire-and-forget: a failed bookkeeping write must not fail the request the
  // caller actually made.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.key.id))
    .catch((error) => console.error("[api-keys] lastUsedAt update failed:", error));

  return { ok: true, user: row.user, key: row.key };
}
