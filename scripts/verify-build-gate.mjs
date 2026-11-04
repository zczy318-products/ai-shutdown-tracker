import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(path.join(tmpdir(), "restinprompts-build-gate-"));
const log = path.join(directory, "calls.jsonl");
try {
  await writeFile(path.join(directory, "npm"), `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(process.env.TEST_BUILD_LOG, JSON.stringify({script: process.argv[3], database: process.env.DATABASE_URL}) + "\\n");
if (process.argv[3] === "db:migrate" && process.env.TEST_FAIL_MIGRATION) process.exit(9);
`, { mode: 0o700 });
  async function check(environment, overrides = {}) {
    await writeFile(log, "");
    const result = spawnSync(process.execPath, ["scripts/vercel-build.mjs"], {
      env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`,
        VERCEL_ENV: environment, DATABASE_URL: "pooled-test-only", DATABASE_URL_UNPOOLED: "direct-test-only",
        TEST_BUILD_LOG: log, TEST_FAIL_MIGRATION: "", ...overrides }, encoding: "utf8",
    });
    const calls = (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse);
    return { code: result.status, calls };
  }
  for (const environment of ["", "preview", "development"]) {
    assert.deepEqual(await check(environment), { code: 0, calls: [{ script: "build", database: "pooled-test-only" }] });
  }
  assert.deepEqual(await check("production"), { code: 0, calls: [
    { script: "db:migrate", database: "direct-test-only" }, { script: "build", database: "pooled-test-only" },
  ] });
  assert.deepEqual(await check("production", { DATABASE_URL_UNPOOLED: "" }), { code: 1, calls: [] });
  assert.deepEqual(await check("production", { TEST_FAIL_MIGRATION: "1" }), { code: 9,
    calls: [{ script: "db:migrate", database: "direct-test-only" }] });
  console.log("PASS build gate: local/preview isolation, production direct connection, missing-config refusal, migration failure stops deployment");
} finally {
  await rm(directory, { recursive: true, force: true });
}
