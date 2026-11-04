# Homepage approval prototype — V2

Open `index.html` for the responsive prototype, or `preview.html` for desktop and 390 px mobile frames. The exact previous version is retained in `../homepage-v1/`. No installation, CDN, font download, backend connection, or build is required.

## Design direction

The user rejected the warm-white/forest-green card direction and requested a table-first homepage. V2 uses the confirmed cool-white, graphite-black, and cobalt-blue palette. A compact workspace introduction, four data counters, search and filters, and the default semantic table replace the marketing hero and card grid.

The six table columns are company/industry, event date, impact/outcome, concise event summary, attribution confidence, and sources. Rows use restrained separators and monogram placeholders, two-line summaries, explicit source buttons, and evidence dialogs. Company and event counts remain distinct. Mobile retains the real table in a named, keyboard-focusable horizontal scroll region, with a sticky company column and visible scroll guidance. Source controls remain reachable after horizontal scrolling.

## UI/UX Pro Max use

Used `/Users/chris_deng/.codex/skills/ui-ux-pro-max/SKILL.md` and its accessibility, interaction, performance, and responsive guidance.

- Initial design-system query `research data table workspace` returned an organic wellness-style result that did not fit. It was rejected.
- One narrower design-system retry, `analytics dashboard minimal professional`, returned **Data-Dense Dashboard**, a suitable table-focused style. Its unrelated enterprise marketing layout was not applied. The confirmed user palette takes precedence over generated palette suggestions.
- UX query `responsive table horizontal scroll` matched **Table Handling**, recommending a horizontal overflow wrapper or card layout. The wrapper matches the user's explicit table-default preference; page-level horizontal overflow is avoided.
- Stack query `table semantic accessible --stack html-tailwind` returned general semantic color-token and accessible-button guidance. Only those relevant recommendations were applied; the prototype uses native HTML/CSS, without Tailwind or invented table-specific search claims.

Focus outlines, a skip link, native dialog keyboard behavior, labeled controls, semantic column and row headers, live result counts, selected filter states, date sort announcements, and reduced-motion handling are included.

## Data and interactions

Content is a local copy of `seed/companies.json`, not a fresh research dataset or a claim of current published production records. The snapshot contains 29 companies and 30 events across 12 industries, with 54 source references representing 48 unique source URLs. Visible source counters use the unique-URL definition. Evidence dialogs preserve original summaries, source URLs, quotations, and counter-evidence. Dates preserve source precision. Initial-letter placeholders are not company logos.

Search, combinable filters, sorting, 10-row pagination, source dialogs, and empty-result reset work locally. Other navigation opens scoped prototype dialogs. Email submission performs native validation and shows a demonstration response without saving or transmitting an address. Copy explicitly states that the existing product only collects subscriptions and email sending is not available. Source links open the original publisher.

## Scope and validation

Only prototype files are changed. Live routes, backend, database, authentication, billing, and deployment are untouched. Static checks confirm valid inline JavaScript, valid embedded JSON, six semantic table column headers, and no external asset dependencies. Browser review is coordinated by the parent agent; this note does not imply unperformed cross-browser or accessibility certification. Jev was not used.

## Approval points

1. Cool-white, graphite-black, cobalt-blue direction and compact workspace hierarchy.
2. Default table, column ordering, row readability, and source drilldown.
3. Search/filter hierarchy and 10-row pagination.
4. Mobile sticky company column and deliberate horizontal table reading.
