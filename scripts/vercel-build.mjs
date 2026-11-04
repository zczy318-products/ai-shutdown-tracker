import { spawnSync } from "node:child_process";

function run(script, env = process.env) {
  const result = spawnSync("npm", ["run", script], { env, stdio: "inherit" });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}

// Preview and local builds must not migrate the shared production database.
if (process.env.VERCEL_ENV === "production") {
  if (!process.env.DATABASE_URL_UNPOOLED?.trim()) {
    console.error("Production migration requires DATABASE_URL_UNPOOLED.");
    process.exit(1);
  }
  run("db:migrate", { ...process.env, DATABASE_URL: process.env.DATABASE_URL_UNPOOLED });
}
run("build");
