"use client";

import { usePathname } from "next/navigation";
import { useActionState } from "react";

import { subscribe, type SubscribeFormState } from "@/app/subscribe/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The public subscribe form. One field, one button, no account.
 *
 * Deliberately not a login form in disguise: there is no password, nothing is
 * created in `users`, and a visitor who only wants to read never has to touch
 * it. It is the main call to action on the public pages precisely because it is
 * the *only* thing we ask for.
 *
 * `required` and `type="email"` are keyboard hints and nothing more — the
 * server re-validates in `subscribeEmailSchema`.
 */

/**
 * What a visitor is told after a successful submission.
 *
 * With no mail provider wired up, the only honest thing to say is that we wrote
 * the address down and that no email exists yet. Saying "确认邮件已发送" here
 * would send someone to refresh an inbox for a message that is never coming,
 * and they would eventually decide the site is broken rather than lying — which
 * is worse.
 */
function successCopy(canDeliver: boolean): { title: string; detail: string } {
  return canDeliver
    ? {
        title: "确认邮件已发出，请查收。",
        detail: "点击邮件里的确认链接即可完成订阅，链接 7 天内有效。没收到可以检查垃圾邮件。",
      }
    : {
        title: "已登记，确认邮件会在邮件服务接通后发出。",
        detail:
          "本站目前还没有接通邮件服务，所以现在不会有邮件到达你的收件箱——不用等。" +
          "订阅在接通后生效，仍然需要你点一次确认链接。",
      };
}

type Props = {
  /**
   * Recorded on the row. Defaults to the current path, which is what makes a
   * single mount in the public layout still tell us whether a signup came from
   * the listing or from a company page. See `subscriber.source`.
   */
  source?: string;
  /** Rendered above the field. */
  title?: string;
  description?: string;
};

export function SubscribeForm({
  source,
  title = "订阅新增记录",
  description = "有新记录发布时收一封邮件。只需要一个邮箱，不用注册、不用设密码，退订一步生效。",
}: Props) {
  const pathname = usePathname();
  const [state, formAction, pending] = useActionState<SubscribeFormState, FormData>(
    subscribe,
    null,
  );

  const copy = state?.status === "ok" ? successCopy(state.canDeliver) : null;

  return (
    <section className="bg-muted/40 rounded-lg border p-5">
      <h2 className="text-base font-medium">{title}</h2>
      <p className="text-muted-foreground mt-1 text-sm">{description}</p>

      {copy ? (
        <div role="status" className="mt-4 space-y-1">
          <p className="text-sm font-medium">{copy.title}</p>
          <p className="text-muted-foreground text-sm">{copy.detail}</p>
        </div>
      ) : (
        <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="source" value={source ?? pathname} />
          <div className="min-w-56 flex-1 space-y-2">
            <Label htmlFor="subscribe-email">邮箱</Label>
            <Input
              id="subscribe-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              placeholder="you@example.com"
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "提交中…" : "订阅"}
          </Button>
          {state?.status === "error" ? (
            <p role="alert" className="text-destructive w-full text-sm">
              {state.message}
            </p>
          ) : null}
        </form>
      )}
    </section>
  );
}
