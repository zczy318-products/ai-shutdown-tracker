# Repository Guidelines

## Project Structure & Module Organization

Rest In Prompts tracks AI-related company shutdowns, layoffs, and pivots with verifiable sources. It uses Next.js App Router, React, strict TypeScript, Tailwind CSS, and Drizzle ORM.

- `src/app/`: public/auth route groups, admin pages, server actions, and API routes.
- `src/components/`: shared UI, charts, and subscription components.
- `src/lib/`: authentication, billing, record validation, publishing, and subscription logic.
- `src/db/`: schema, driver configuration, migration runner, and seeding.
- `drizzle/`: SQL migrations and metadata; `seed/companies.json`: source-backed seed records.
- `scripts/`: integration and browser checks; `docs/acceptance/`: screenshots and export evidence.

## Build, Test, and Development Commands

Use npm, not pnpm.

- `npm install`: install dependencies.
- `npm run db:migrate`: apply migrations to the configured database.
- `npm run db:seed`: import seed records.
- `npm run dev`: serve locally at `http://localhost:3000`.
- `npm run build` / `npm start`: build / serve the production bundle.
- `npm run typecheck`: check TypeScript without emitting JavaScript.
- `npm run db:generate`: generate migrations after editing `src/db/schema.ts`.

## Coding Style & Naming Conventions

Match existing two-space indentation, double quotes, and semicolons. Use PascalCase for components/types, camelCase for functions/variables, and kebab-case filenames. Follow Next.js names such as `page.tsx`, `route.ts`, and `actions.ts`. Use `@/` imports for `src/`. Write new code comments and documentation in English. No dedicated lint or formatter command is configured.

## Testing Guidelines

Checks use Node.js/tsx scripts and Playwright; no numeric coverage threshold is configured. Name checks `scripts/verify-<feature>.mjs` or `.mts`.

Run typechecking and checks relevant to changed behavior:

- `verify:auth`, `verify:records`, and `verify:saas` require a running local server; override `BASE_URL` if needed.
- `verify:public` requires a completed build and starts its own temporary database/server.
- `verify:db`, `verify:pg`, and `verify:subscribe` manage temporary databases.
- `verify:a11y` checks desktop/mobile pages using Playwright Chromium.

Invoke checks with `npm run <name>`. Use local test targets for flows that create accounts or modify records.

## Commit & Pull Request Guidelines

Follow history's Conventional Commits: `fix: ...`, `feat(pricing): ...`, or `docs(acceptance): ...`. Keep subjects concise; omit AI attribution and co-author trailers. PRs should explain behavior changes, link relevant issues, report verification, and include screenshots for UI changes.

## Security & Configuration

Keep secrets in ignored `.env.local`. Local development defaults to PGlite; production requires `DATABASE_URL`. Preserve per-page server authentication before admin data reads and source-validation publishing rules. Consult `DEPLOY.md` before releases and `docs/ACCEPTANCE.md` for acceptance evidence.
