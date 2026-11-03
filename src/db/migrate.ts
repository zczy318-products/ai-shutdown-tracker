/**
 * Applies the SQL files in ./drizzle to whichever database is configured.
 *
 * Run with `npm run db:migrate`. Generate new SQL first with
 * `npm run db:generate` after editing `src/db/schema.ts`.
 */
import path from "node:path";

import { config } from "dotenv";

import { describeDbTarget, resolveDbTarget } from "./config";
import * as schema from "./schema";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

async function main() {
  const target = resolveDbTarget();
  console.log(`[migrate] target: ${describeDbTarget(target)}`);

  if (target.kind === "postgres") {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { default: pg } = await import("pg");

    const pool = new pg.Pool({
      connectionString: target.connectionString,
      // Same reasoning as src/db/index.ts: verify the server certificate.
      ssl: target.ssl ? { rejectUnauthorized: true } : undefined,
    });
    try {
      await migrate(drizzle(pool, { schema }), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await pool.end();
    }
  } else {
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const { PGlite } = await import("@electric-sql/pglite");

    const client = new PGlite(target.dataDir);
    try {
      await client.waitReady;
      await migrate(drizzle(client, { schema }), { migrationsFolder: MIGRATIONS_FOLDER });
    } finally {
      await client.close();
    }
  }

  console.log("[migrate] done");
}

main().catch((error) => {
  console.error("[migrate] failed:", error);
  process.exit(1);
});
