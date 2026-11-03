import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

import { resolveDbTarget } from "./src/db/config";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const target = resolveDbTarget();

/**
 * `drizzle-kit generate` only reads the schema, so it works offline for either
 * driver. The credentials below matter for `studio` / `push`, which is why the
 * dialect follows the same resolution the app uses.
 */
export default defineConfig(
  target.kind === "postgres"
    ? {
        schema: "./src/db/schema.ts",
        out: "./drizzle",
        dialect: "postgresql",
        dbCredentials: { url: target.connectionString },
      }
    : {
        schema: "./src/db/schema.ts",
        out: "./drizzle",
        dialect: "postgresql",
        driver: "pglite",
        dbCredentials: { url: target.dataDir },
      },
);
