/**
 * Grants or revokes the editor role on one account, by email.
 *
 *   node scripts/grant-role.mjs <email> viewer|editor [--yes]
 *
 * This exists because write access is deliberately not grantable from inside
 * the application: nothing in `/register`, `/account` or the billing webhook
 * can change `users.role` (ZCZ-15). Promotion is a human act, so it needs a
 * human-run command — and a local one, because PGlite has no `psql`.
 *
 * Two guards, both on purpose:
 *
 *  - the email and the role are positional arguments with no defaults. There is
 *    no "promote the first account" convenience here either;
 *  - against a real `DATABASE_URL` it refuses to write without `--yes`, and it
 *    prints which database it is about to touch first. The hosted database is
 *    the live site.
 *
 * Against a hosted Postgres the statement itself is the documented way, and it
 * is what this script runs:
 *
 *   update users set role = 'editor' where email = '<the address>';
 */
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const [email, role, ...rest] = process.argv.slice(2);
const confirmed = rest.includes("--yes");

if (!email || !role) {
  console.error("usage: node scripts/grant-role.mjs <email> viewer|editor [--yes]");
  process.exit(2);
}
if (role !== "viewer" && role !== "editor") {
  console.error(`unknown role ${JSON.stringify(role)}. Use viewer or editor.`);
  process.exit(2);
}

const normalized = email.trim().toLowerCase();
const url = process.env.DATABASE_URL?.trim();
const dataDir = process.env.PGLITE_DATA_DIR?.trim() || ".pglite";

console.log(`target: ${url ? "node-postgres (DATABASE_URL)" : `PGlite (${dataDir})`}`);
console.log(`setting role = ${role} for ${normalized}`);

if (url && !confirmed) {
  console.error(
    "\nDATABASE_URL is set, so this would write to the hosted database. " +
      "Re-run with --yes if that is what you mean.",
  );
  process.exit(1);
}

const SELECT = `select email, role, plan from users where email = $1`;
const UPDATE = `update users set role = $2 where email = $1 returning email, role, plan`;

async function main() {
  if (url) {
    const { default: pg } = await import("pg");
    const client = new pg.Client({
      connectionString: url,
      ssl: process.env.DATABASE_SSL?.trim().toLowerCase() !== "false"
        ? { rejectUnauthorized: true }
        : undefined,
    });
    await client.connect();
    try {
      return await apply((text, values) => client.query(text, values));
    } finally {
      await client.end();
    }
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const client = new PGlite(dataDir);
  await client.waitReady;
  try {
    return await apply((text, values) => client.query(text, values));
  } finally {
    await client.close();
  }
}

async function apply(query) {
  const before = await query(SELECT, [normalized]);
  if (before.rows.length === 0) {
    // Not an error worth a stack trace, but not a success either: a typo in an
    // address would otherwise look like a grant that silently did nothing.
    console.error(`\nno account with that email. Nothing changed.`);
    process.exitCode = 1;
    return;
  }
  console.log(`before: ${before.rows[0].role} (plan ${before.rows[0].plan})`);
  const after = await query(UPDATE, [normalized, role]);
  console.log(`after:  ${after.rows[0].role} (plan ${after.rows[0].plan})`);
  console.log("\nthe plan column was not touched: role and plan are independent.");
}

await main();
