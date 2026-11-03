/**
 * The server-rendered twin of `src/app/(public)/error.tsx`.
 *
 * Same words, same retry, but rendered on the server so it survives a visitor
 * without JavaScript — see the note on `loadPublic`. It is deliberately not a
 * variation on an empty state: a reader has to be able to tell «we could not
 * read the records» from «there are no records».
 */
export function DataUnavailable({ retryHref }: { retryHref: string }) {
  return (
    <div className="mx-auto max-w-xl space-y-4 py-16">
      <h1 className="text-destructive text-xl font-semibold tracking-tight">数据暂时读取失败</h1>
      <p className="text-muted-foreground text-sm leading-relaxed">
        这不是「没有记录」，而是这一次没能把记录读出来——数据库可能正在冷启动或暂时不可用。
        记录本身没有丢失，稍等几秒重试通常就能打开。
      </p>
      <a
        href={retryHref}
        className="bg-primary text-primary-foreground hover:bg-primary/90 inline-block rounded-md px-4 py-2 text-sm font-medium"
      >
        重试
      </a>
    </div>
  );
}
