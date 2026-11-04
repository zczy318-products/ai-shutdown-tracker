# Homepage approval prototype

Open `index.html` directly for the responsive prototype, or `preview.html` for side-by-side desktop and 390 px mobile frames. No package installation, external font, CDN, backend connection, or build is required.

## Design direction

An editorial archive with warm paper surfaces, restrained forest-green actions, a Chinese serif headline, system sans-serif body text, monogram placeholders, and compact source-backed cards. The desktop hero provides product context without hiding the archive entry point. Mobile prioritizes content and omits the decorative archive illustration.

UI/UX Pro Max was used from `/Users/chris_deng/.codex/skills/ui-ux-pro-max/SKILL.md`:

- Design-system query: `research news archive editorial`. The verified match was Minimalism & Swiss Style with editorial typography. Its news-oriented red palette and full-bleed hero recommendation were deliberately adapted to the product's neutral research context and existing restrained visual direction.
- Stack query: `responsive search filters --stack nextjs` returned an unrelated image recommendation. A narrower retry, `searchParams filtering --stack nextjs`, returned no matches. Therefore no search-derived filtering implementation claim is made. The prototype uses browser-native controls; production integration should retain the existing URL-backed Next.js filters.
- Reviewed the skill entrypoint and relevant accessibility, interaction, performance, and responsive guidance. Focus outlines, native dialog keyboard handling, a skip link, labeled inputs, live result counts, semantic headings, and reduced-motion handling are included.

## Content and interactions

Content is a local copy of `seed/companies.json`, not a new research dataset and not a claim of current published production records. Counts are calculated from that copy. Company count and event count remain distinct; public-source count means unique source URLs. Cards use shortened display names and initial-letter placeholders rather than invented brand logos. Event dates preserve the original precision. Evidence dialogs preserve original summaries, quotations, source URLs, and counter-evidence.

Search, combinable filters, sorting, pagination, source dialogs, and empty-result reset work locally. Navigation to data observation, pricing, editing, methodology, correction, and privacy opens scoped prototype dialogs. Subscription performs native email validation and displays an explicit demonstration response; it does not persist or transmit the email. Outbound source links open the original publisher.

## Scope

Only prototype files are added. Live routes, backend behavior, database, authentication, billing, and deployment remain outside this artifact. No external data was sent to Jev; Jev was not used.

## Approval points

1. Editorial visual direction, warm white and green palette, typography, and decorative archive motif.
2. Three-column desktop record density and single-column mobile cards.
3. Search-first filters, event-type tabs, and a separate evidence dialog.
4. Subscription hierarchy and restrained trust/source messaging.
