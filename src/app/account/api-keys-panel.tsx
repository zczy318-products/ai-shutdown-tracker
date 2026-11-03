"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { issueApiKey, revokeApiKeyAction, type ApiKeyFormState } from "./actions";

/**
 * API key list, issue form and revoke buttons.
 *
 * The plaintext key comes back in the action's state and is rendered once,
 * with the reason it will not be shown again stated next to it rather than
 * left to be discovered. Everything else on this panel works from the stored
 * prefix.
 */

export type KeyRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function Feedback({ state }: { state: ApiKeyFormState }) {
  if (!state) return null;
  if ("error" in state) {
    return (
      <p
        role="alert"
        className="border-destructive/50 bg-destructive/10 mt-3 rounded-md border p-3 text-sm"
      >
        {state.error}
      </p>
    );
  }
  if ("message" in state) {
    return <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{state.message}</p>;
  }
  return null;
}

function RevokeButton({ keyId }: { keyId: string }) {
  const [state, action, pending] = useActionState<ApiKeyFormState, FormData>(
    revokeApiKeyAction,
    null,
  );

  return (
    <div className="text-right">
      <form action={action}>
        <input type="hidden" name="keyId" value={keyId} />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="text-destructive"
          disabled={pending}
        >
          {pending ? "吊销中…" : "吊销"}
        </Button>
      </form>
      <Feedback state={state} />
    </div>
  );
}

export function ApiKeysPanel({ keys, enabled }: { keys: KeyRow[]; enabled: boolean }) {
  const [state, action, pending] = useActionState<ApiKeyFormState, FormData>(issueApiKey, null);
  const issued = state && "token" in state ? state : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>API key</CardTitle>
        <CardDescription>
          用于 <code>GET /api/v1/records</code> 与带 key 的 CSV 导出。只读接口，没有写入能力。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {enabled ? (
          <form action={action} className="flex flex-wrap items-end gap-3">
            <div className="min-w-50 flex-1 space-y-2">
              <Label htmlFor="key-name">名称</Label>
              <Input
                id="key-name"
                name="name"
                placeholder="例如：研究脚本 / 看板同步"
                maxLength={80}
                required
              />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "生成中…" : "生成新的 key"}
            </Button>
          </form>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-sm">
            API key 属于专业版。升级后可以在这里生成。
          </p>
        )}

        <Feedback state={state} />

        {issued ? (
          <div className="space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4">
            <p className="text-sm font-medium">「{issued.name}」已生成。现在复制它。</p>
            <code className="block overflow-x-auto rounded bg-background/70 p-3 font-mono text-xs select-all">
              {issued.token}
            </code>
            <p className="text-muted-foreground text-xs">
              我们只保存它的哈希值，所以这串明文<strong>只会出现这一次</strong>。
              页面刷新后就拿不回来了 —— 丢了就吊销旧的、生成一个新的。
            </p>
          </div>
        ) : null}

        {keys.length === 0 ? (
          <p className="text-muted-foreground text-sm">还没有任何 key。</p>
        ) : (
          <div className="divide-y rounded-md border">
            {keys.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{item.name}</span>
                    {item.revokedAt ? (
                      <span className="text-destructive text-xs">已吊销</span>
                    ) : (
                      <span className="text-xs text-emerald-700 dark:text-emerald-400">有效</span>
                    )}
                  </div>
                  <div className="text-muted-foreground font-mono text-xs">
                    {item.tokenPrefix}…
                  </div>
                  <div className="text-muted-foreground text-xs">
                    创建于 {item.createdAt}
                    {item.lastUsedAt ? ` · 最近使用 ${item.lastUsedAt}` : " · 从未使用"}
                    {item.revokedAt ? ` · 吊销于 ${item.revokedAt}` : ""}
                  </div>
                </div>
                {item.revokedAt ? null : <RevokeButton keyId={item.id} />}
              </div>
            ))}
          </div>
        )}

        <details className="text-muted-foreground text-sm">
          <summary className="cursor-pointer">怎么调用</summary>
          <pre className="bg-muted/50 mt-2 overflow-x-auto rounded-md p-3 font-mono text-xs">
{`curl -H "Authorization: Bearer <你的 key>" \\
  "$BASE_URL/api/v1/records?limit=20"

curl -H "Authorization: Bearer <你的 key>" \\
  "$BASE_URL/api/export/records" -o records.csv`}
          </pre>
          <p className="mt-2 text-xs">
            吊销后，同样的调用会立刻返回 401 并说明这个 key 已被吊销。
          </p>
        </details>
      </CardContent>
    </Card>
  );
}
