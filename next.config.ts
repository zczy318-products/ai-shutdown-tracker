import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WASM payload that must not be bundled, and `pg` loads
  // optional native bindings. Keeping both external lets them load from
  // node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],

  // PGlite is a devDependency used only when DATABASE_URL is unset, but the
  // dynamic import in src/db/index.ts is still a trace target, and its wasm is
  // tens of megabytes — enough to hit Vercel Hobby's uncompressed function size
  // limit. Exclude it: on a deployment DATABASE_URL is always set, and
  // resolveDbTarget() throws before the import can run if it is not.
  outputFileTracingExcludes: {
    "**": ["node_modules/@electric-sql/pglite/**"],
  },

  // Next otherwise rewrites an AGENTS.md at the repo root on every dev start,
  // which churns in git and would overwrite a hand-written one.
  agentRules: false,
};

export default nextConfig;
