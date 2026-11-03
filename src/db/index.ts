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
    });
    return drizzle(pool, { schema }) as unknown as Database;
  }

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
