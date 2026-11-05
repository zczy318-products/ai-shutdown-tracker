/**
 * Driver selection, in one place so the app, the migrator and drizzle-kit all
 * agree on which database they are talking to.
 */
export type DbTarget =
  | {
      kind: "postgres";
      connectionString: string;
      ssl: boolean;
      poolMax: number;
      idleTimeoutMillis: number;
    }
  | { kind: "pglite"; dataDir: string };

const DEFAULT_PGLITE_DIR = ".pglite";

/**
 * One connection per instance by default.
 *
 * The deployment target is Vercel Serverless against Neon's free tier. Each
 * concurrent function instance evaluates this module separately, so a pool of
 * `n` means `instances * n` server-side connections — the free tier's connection
 * limit is reached long before traffic is interesting. The pooled Neon endpoint
 * (hostname containing `-pooler`) does the actual multiplexing; `pg` only needs
 * to hold one socket per instance and drop it quickly when idle.
 *
 * Raise `DATABASE_POOL_MAX` for a long-lived (non-serverless) deployment.
 */
const DEFAULT_POOL_MAX = 1;
const DEFAULT_IDLE_TIMEOUT_MS = 10_000;

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw?.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

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
    // pg lets URL SSL options override Pool.ssl. Enforce verification even if
    // a copied connection string contains sslmode=no-verify or libpq overrides.
    const ssl = env.DATABASE_SSL?.trim().toLowerCase() !== "false";
    let connection: URL;
    try {
      connection = new URL(url);
      if (!["postgres:", "postgresql:"].includes(connection.protocol)) throw new Error();
    } catch {
      // URL parsing errors otherwise carry their original input, including passwords.
      throw new Error("DATABASE_URL must be a valid Postgres connection URL");
    }
    connection.searchParams.delete("uselibpqcompat");
    connection.searchParams.set("sslmode", ssl ? "verify-full" : "disable");
    // Managed providers terminate TLS, but a self-hosted Postgres on a private
    // network may not. Default to on and let DATABASE_SSL=false opt out.
    return {
      kind: "postgres",
      connectionString: connection.toString(),
      ssl,
      poolMax: positiveInt(env.DATABASE_POOL_MAX, DEFAULT_POOL_MAX),
      idleTimeoutMillis: positiveInt(env.DATABASE_IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS),
    };
  }

  // PGlite is a local-development convenience and must never serve production
  // traffic: it persists to the filesystem, and a serverless function's
  // filesystem is read-only. Failing here with an actionable message beats the
  // EROFS stack trace a first request would otherwise produce.
  if (env.NODE_ENV === "production" && env.PGLITE_ALLOW_PRODUCTION?.trim() !== "true") {
    throw new Error(
      "DATABASE_URL is required in production. PGlite is local-development only " +
        "(it writes to disk, which serverless runtimes do not allow). Set " +
        "DATABASE_URL to the pooled Postgres connection string, or set " +
        "PGLITE_ALLOW_PRODUCTION=true for a local production-build smoke test.",
    );
  }

  return { kind: "pglite", dataDir: env.PGLITE_DATA_DIR?.trim() || DEFAULT_PGLITE_DIR };
}

/** Safe to render in the UI: never includes credentials. */
export function describeDbTarget(target: DbTarget): string {
  return target.kind === "postgres"
    ? "node-postgres (DATABASE_URL)"
    : `PGlite (${target.dataDir})`;
}
