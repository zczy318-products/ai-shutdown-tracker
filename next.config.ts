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

  /**
   * Guessable aliases for the two public pages whose names people keep
   * reaching for. The listing lives at `/` (it is the product's front page,
   * not a sub-section) and the dashboard at `/stats`; both `/companies` and
   * `/dashboard` were being typed and returning 404.
   *
   * Redirects rather than duplicate routes, so there is still exactly one URL
   * per page and no split of inbound links. Temporary (307) on purpose: these
   * are conveniences, and a 308 would be cached by browsers long after we
   * changed our mind about the canonical names.
   */
  async redirects() {
    return [
      { source: "/companies", destination: "/", permanent: false },
      { source: "/dashboard", destination: "/stats", permanent: false },
    ];
  },
};

export default nextConfig;
