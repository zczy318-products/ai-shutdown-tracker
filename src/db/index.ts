import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { type DbTarget, resolveDbTarget } from "./config";
import * as schema from "./schema";

/**
 * Driver-agnostic handle. Both `node-postgres` and `PGlite` produce a
 * `PgDatabase`; narrowing to the base type here means application code never
 * branches on which one is live.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export { schema };

async function createDb(target: DbTarget): Promise<Database> {
  if (target.kind === "postgres") {
    const [{ drizzle }, pg] = await Promise.all([
      import("drizzle-orm/node-postgres"),
      import("pg"),
    ]);
    const pool = new pg.default.Pool({
      connectionString: target.connectionString,
      // Verify the chain. `rejectUnauthorized: false` would accept any
      // certificate, i.e. no protection against a MITM on the hop to the
      // managed database. Neon/Supabase/RDS all present a public CA chain.
      ssl: target.ssl ? { rejectUnauthorized: true } : undefined,
      // See DEFAULT_POOL_MAX in ./config: one socket per function instance,
      // released quickly, with Neon's pooled endpoint doing the multiplexing.
      max: target.poolMax,
      idleTimeoutMillis: target.idleTimeoutMillis,
      // Neon's free tier autosuspends when idle; a cold start can take a few
      // seconds. The pg default of 0 means "wait forever", which would hang a
      // request rather than surface a connectivity problem.
      connectionTimeoutMillis: 15_000,
    });
    // A pool error with no listener is an unhandled 'error' event, which takes
    // the whole function instance down. Neon dropping an idle socket is normal.
    pool.on("error", (error) => {
      console.error("[db] idle client error:");
    });
    return drizzle(pool, { schema }) as unknown as Database;
  }

  // Loaded lazily and never on a production path (resolveDbTarget throws first),
  // so the PGlite wasm payload stays out of the serverless bundle.
  const [{ drizzle }, { PGlite }] = await Promise.all([
    import("drizzle-orm/pglite"),
    import("@electric-sql/pglite"),
  ]);
  const client = new PGlite(target.dataDir);
  await client.waitReady;
  return drizzle(client, { schema }) as unknown as Database;
}

/**
 * Cached on globalThis rather than in a module-level `let`: the Next dev server
 * re-evaluates modules on hot reload, and a fresh PGlite handle per reload would
 * both leak file locks and lose the connection pool.
 */
const globalForDb = globalThis as typeof globalThis & {
  __aistDb?: Promise<Database>;
};

export function getDb(): Promise<Database> {
  globalForDb.__aistDb ??= createDb(resolveDbTarget());
  return globalForDb.__aistDb;
}
