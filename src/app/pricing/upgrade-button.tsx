"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { startUpgrade, simulateDowngrade, type BillingFormState } from "./actions";

/**
 * The upgrade / downgrade controls.
 *
 * A client component only because `useActionState` gives the pending state and
 * the error text without a page reload. The decision about *which* backend
 * runs stays on the server in `startUpgrade` — nothing here knows or cares
 * whether a Stripe session is about to be created.
 */

function Feedback({ state }: { state: BillingFormState }) {
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
  return (
    <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">
      {"message" in state ? state.message : null}
    </p>
  );
}

export function UpgradeButton({
  label,
  mode,
}: {
  label: string;
  mode: "stripe_test" | "simulated";
}) {
  const [state, action, pending] = useActionState<BillingFormState, FormData>(startUpgrade, null);

  return (
    <div>
      <form action={action}>
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending
            ? mode === "stripe_test"
              ? "正在跳转 Stripe 测试结账…"
              : "正在升级…"
            : label}
        </Button>
      </form>
      <Feedback state={state} />
    </div>
  );
}

export function DowngradeButton() {
  const [state, action, pending] = useActionState<BillingFormState, FormData>(
    simulateDowngrade,
    null,
  );

  return (
    <div>
      <form action={action}>
        <Button type="submit" variant="outline" size="sm" disabled={pending}>
          {pending ? "处理中…" : "模拟降级回免费档"}
        </Button>
      </form>
      <Feedback state={state} />
    </div>
  );
}
