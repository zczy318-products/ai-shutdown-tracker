import { readFile, stat } from "node:fs/promises";
import { config } from "dotenv";

import { importBatch } from "../src/lib/ingestion/import";

config({ path: ".env.local", quiet: true });
const args = process.argv.slice(2);
const file = args.find((arg) => !arg.startsWith("--"));
if (!file || args.some((arg) => arg.startsWith("--") && !["--dry-run", "--write"].includes(arg)) ||
    (args.includes("--dry-run") && args.includes("--write"))) {
  console.error("Usage: npm run import:research -- <batch.json> [--dry-run | --write] (default: dry-run)");
  process.exit(1);
}

try {
  if ((await stat(file)).size > 5_000_000) throw new Error("batch_file_too_large");
  const dryRun = !args.includes("--write");
  const results = await importBatch(JSON.parse(await readFile(file, "utf8")), { dryRun });
  console.log(JSON.stringify({ dryRun, results }, null, 2));
  process.exit(0);
} catch (error) {
  console.error("Research import failed:", error instanceof Error ? error.message : "unknown_error");
  process.exit(1);
}
