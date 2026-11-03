import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A native `<select>`, not the Radix listbox.
 *
 * The admin form posts as a plain form so the server action receives real
 * `FormData` and the whole thing degrades without JavaScript. A native select
 * participates in that automatically; the Radix version needs a hidden input
 * and client state per field, for a form with a dozen enum fields on it.
 */
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        "border-input bg-background flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { Select };
