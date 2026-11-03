/**
 * Driver selection, in one place so the app, the migrator and drizzle-kit all
 * agree on which database they are talking to.
 */
export type DbTarget =
  | { kind: "postgres"; connectionString: string; ssl: boolean }
  | { kind: "pglite"; dataDir: string };

const DEFAULT_PGLITE_DIR = ".pglite";

/**
 * `dataDir` stays a relative path on purpose. Resolving it against
 * `process.cwd()` here would put a dynamic `path.resolve(process.cwd(), ...)`
 * into the server bundle, which makes Turbopack trace the whole project
 * directory as a runtime dependency. PGlite resolves relative paths from the
 * working directory itself, which is what we want anyway.
 */
export function resolveDbTarget(env: NodeJS.ProcessEnv = process.env): DbTarget {
  const url = env.DATABASE_URL?.trim();

  if (url) {
    // Managed providers terminate TLS, but a self-hosted Postgres on a private
    // network may not. Default to on and let DATABASE_SSL=false opt out.
    return {
      kind: "postgres",
      connectionString: url,
      ssl: env.DATABASE_SSL?.trim().toLowerCase() !== "false",
    };
  }

  return { kind: "pglite", dataDir: env.PGLITE_DATA_DIR?.trim() || DEFAULT_PGLITE_DIR };
}

/** Safe to render in the UI: never includes credentials. */
export function describeDbTarget(target: DbTarget): string {
  return target.kind === "postgres"
    ? "node-postgres (DATABASE_URL)"
    : `PGlite (${target.dataDir})`;
}
