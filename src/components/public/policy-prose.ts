/**
 * Typography for the two policy pages (`/methodology`, `/corrections`).
 *
 * Both pages are long-form text that Product PM wrote and signed off on, and
 * neither may be reworded. So the styling lives here as one class string rather
 * than being sprinkled over the markup: the page files stay close to the plain
 * document they are reproducing, which is what makes "is this still the
 * approved copy?" a readable diff instead of an archaeology exercise.
 *
 * Not `@tailwindcss/typography` — the project does not ship the plugin, and
 * pulling in a whole prose theme to style eight element types would also bring
 * its own colour and spacing opinions into a design system that already has
 * them.
 *
 * Child selectors (`&>p`) rather than descendant ones wherever the markup is
 * flat, so a nested element inside a table cell or a list item does not
 * silently inherit a top margin meant for a top-level paragraph.
 *
 * `text-[15px]` with `leading-relaxed` gives a 24.4 px line box, which is what
 * keeps an inline link in running text at or above the 24 × 24 minimum in WCAG
 * 2.2 §2.5.8. Dropping to `text-sm` here would put every source link and every
 * cross-reference on these pages under it — the same trap the header nav and
 * the company page's source links already had to be padded out of.
 */
export const policyProse = [
  "max-w-prose text-[15px] leading-relaxed",
  "[&>h2]:text-foreground [&>h2]:mt-10 [&>h2]:mb-3 [&>h2]:text-lg [&>h2]:font-medium [&>h2]:tracking-tight",
  "[&>p]:text-muted-foreground [&>p]:mt-4",
  "[&>ol]:text-muted-foreground [&>ol]:mt-4 [&>ol]:list-decimal [&>ol]:space-y-2 [&>ol]:pl-6",
  "[&>ul]:text-muted-foreground [&>ul]:mt-4 [&>ul]:list-disc [&>ul]:space-y-2 [&>ul]:pl-6",
  "[&_strong]:text-foreground [&_strong]:font-medium",
  "[&_a]:text-foreground [&_a]:underline",
].join(" ");

/** The `<table>` on `/methodology`. Borders only — no status colour anywhere. */
export const policyTable = [
  "mt-4 w-full border-collapse text-left text-sm",
  "[&_th]:border-b [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium [&_th]:align-top",
  "[&_td]:text-muted-foreground [&_td]:border-b [&_td]:px-3 [&_td]:py-3 [&_td]:align-top",
].join(" ");
