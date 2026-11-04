/** Verify public-source quotations using the production retriever, without a DB. */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { retrieveSource, normalizeQuote } from "../../src/lib/ingestion/retrieve.ts";

const directory = new URL("./", import.meta.url);
const batch = JSON.parse(await readFile(new URL("historical-backfill.json", directory), "utf8"));
const results = await Promise.all(batch.candidates.filter((candidate) => candidate.record).map(async (candidate) => {
  const source = candidate.record.sources[0];
  try {
    const fetched = await retrieveSource(source.url);
    const quoteOffset = normalizeQuote(fetched.text).indexOf(normalizeQuote(source.quote));
    return { id: candidate.id, url: source.url, status: fetched.status, method: fetched.method,
      retrievedAt: fetched.retrievedAt, quoteMatched: quoteOffset >= 0, quoteOffset, finalUrl: fetched.finalUrl };
  } catch (error) {
    return { id: candidate.id, url: source.url, error: error.message, quoteMatched: false };
  }
}));
const result = { checkedAt: new Date().toISOString(),
  scope: "Live public-source retrieval using existing importer retrieveSource only; no database access or publication.", results };
const output = new URL("backfill-fetch-check.json", directory);
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output: fileURLToPath(output), matched: results.filter((item) => item.quoteMatched).length,
  total: results.length, results }, null, 2));
process.exitCode = results.every((item) => item.quoteMatched) ? 0 : 2;
