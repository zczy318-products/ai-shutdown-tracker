"use client";

import { useEffect } from "react";

/**
 * Error boundary for the three public routes.
 *
 * The point of this file is a distinction that is easy to lose: **«读不到» and
 * «确实没有» must not look the same.** Wrapping the queries in a try/catch that
 * falls back to an empty list would be the tempting fix, and it would mean that
 * the day the database is unreachable the site quietly announces «已发布记录
 * (0)» — i.e. it would claim we have never recorded a single company. So the
 * pages do not catch anything; a failed query propagates here and says so.
 *
 * This is a live concern rather than a hypothetical: Neon's free tier
 * autosuspends, so a cold start can time out, and this is a public site an
 * anonymous visitor opens directly.
 *
 * `reset()` re-runs the failed render, which is exactly the right retry for a
 * cold database — the second attempt usually lands after the instance is awake.
 */

export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The browser never sees the message (Next redacts it in production); the
    // digest is what ties this page to the server log line.
    console.error("[public] render failed:", error.digest ?? error.message);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl space-y-4 py-16">
      <h1 className="text-destructive text-xl font-semibold tracking-tight">数据暂时读取失败</h1>
      <p className="text-muted-foreground text-sm leading-relaxed">
        这不是「没有记录」，而是这一次没能把记录读出来——数据库可能正在冷启动或暂时不可用。
        记录本身没有丢失，稍等几秒重试通常就能打开。
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium"
        >
          重试
        </button>
        <a href="/" className="text-muted-foreground hover:text-foreground text-sm underline">
          回到记录榜单
        </a>
      </div>
      {error.digest ? (
        <p className="text-muted-foreground font-mono text-xs">
          错误编号：{error.digest}
          <span className="ml-2 font-sans">（反馈时带上这个编号，可以在服务端日志里对上这次失败）</span>
        </p>
      ) : null}
    </div>
  );
}
