import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WASM payload that must not be bundled, and `pg` loads
  // optional native bindings. Keeping both external lets them load from
  // node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],

  // Next otherwise rewrites an AGENTS.md at the repo root on every dev start,
  // which churns in git and would overwrite a hand-written one.
  agentRules: false,
};

export default nextConfig;
