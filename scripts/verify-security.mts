import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { isAdmin } from "../src/lib/authorization";
import { clientAddress } from "../src/lib/client-ip";
import { resolveDbTarget } from "../src/db/config";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { resolveMailer } from "../src/lib/mailer";
import { trustedOrigin } from "../src/lib/subscribe/links";
import { consumeAuthBudget } from "../src/lib/auth-rate-limit";
import { toCsvRow } from "../src/lib/export/csv";

const originalEnv = { ...process.env };
const originalInfo = console.info;
const client = new PGlite();
try {
  assert.equal(isAdmin({ id: "ordinary" }, ""), false);
  assert.equal(isAdmin({ id: "ordinary" }, "admin"), false);
  assert.equal(isAdmin({ id: "admin" }, " admin,second "), true);
  assert.equal(isAdmin({ id: "" }, ""), false);
  console.log("PASS explicit administrator IDs; no default or empty-ID administrator");

  delete process.env.VERCEL;
  delete process.env.TRUST_PROXY;
  const spoofed = new Headers({ "x-forwarded-for": "8.8.8.8", "x-real-ip": "1.1.1.1" });
  assert.equal(clientAddress(spoofed), "unknown");
  process.env.TRUST_PROXY = "true";
  assert.equal(clientAddress(spoofed), "8.8.8.8");
  assert.equal(clientAddress(new Headers({ "x-forwarded-for": "invalid" })), "unknown");
  console.log("PASS untrusted proxy headers cannot rotate the default throttle bucket");

  const target = resolveDbTarget({ DATABASE_URL: "postgres://fixture:unused@localhost/db?sslmode=no-verify&uselibpqcompat=true" });
  assert.equal(target.kind, "postgres");
  if (target.kind === "postgres") {
    assert.equal(new URL(target.connectionString).searchParams.get("sslmode"), "verify-full");
    assert.equal(new URL(target.connectionString).searchParams.has("uselibpqcompat"), false);
  }
  console.log("PASS database URL cannot override certificate verification");
  assert.throws(() => resolveDbTarget({ DATABASE_URL: "invalid-credential-fixture" }),
    (error: unknown) => error instanceof Error && !JSON.stringify(error).includes("invalid-credential-fixture") && !error.message.includes("invalid-credential-fixture"));

  const password = "local-security-fixture";
  const hashed = await hashPassword(password);
  assert.equal(await verifyPassword(password, hashed), true);
  assert.equal(await verifyPassword("wrong-password", hashed), false);
  assert.equal(await verifyPassword(password, "scrypt$1$1$1$$"), false);
  console.log("PASS password verification rejects corrupt and empty digests");

  for (const environment of ["development", "production"]) {
    process.env.NODE_ENV = environment;
    delete process.env.MAIL_LOG_CONTENT;
    let output = "";
    console.info = (...args) => { output += args.join(" "); };
    const message = { to: "private-fixture@example.com", subject: "fixture", html: "private-token-fixture" };
    assert.equal((await resolveMailer().send(message)).delivered, false);
    assert.equal(output.includes(message.to) || output.includes(message.html), false);
    if (environment === "production") {
      process.env.MAIL_LOG_CONTENT = "true";
      await resolveMailer().send(message);
      assert.equal(output.includes(message.to) || output.includes(message.html), false);
    }
    console.info = originalInfo;
  }
  console.log("PASS mail logs redact recipients and tokens, including production opt-in attempts");

  assert.equal(trustedOrigin("https://example.com"), "https://example.com");
  assert.equal(trustedOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  for (const url of ["javascript:alert(1)", "http://example.com", "https://name:password@example.com", "https://example.com/?x=1"]) {
    assert.throws(() => trustedOrigin(url));
  }
  console.log("PASS subscription origins reject unsafe schemes and credentials");
  assert.equal(toCsvRow(["=1+1", "\n=1+1"]), "'=1+1,\"'\n=1+1\"");
  console.log("PASS CSV formula and leading-control-character injection neutralized");

  await client.waitReady;
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: "drizzle" });
  (globalThis as Record<string, unknown>).__aistDb = Promise.resolve(db);
  const attempts = await Promise.all(Array.from({ length: 12 }, () => consumeAuthBudget("fixture@example.com", "8.8.8.8")));
  assert.equal(attempts.filter(Boolean).length, 10);
  const rows = await client.query<{ key_hash: string }>("select key_hash from subscribe_throttle");
  assert(rows.rows.every((row) => /^[a-f0-9]{64}$/.test(row.key_hash)));
  console.log("PASS durable concurrent authentication throttling and hashed identifiers");
  const rotated = await Promise.all(Array.from({ length: 35 }, (_, index) => consumeAuthBudget(`rotated-${index}@example.com`, "9.9.9.9")));
  assert.equal(rotated.filter(Boolean).length, 30);
  const afterRotation = await client.query("select key_hash from subscribe_throttle");
  assert.equal(afterRotation.rows.length - rows.rows.length, 31);
  console.log("PASS blocked clients cannot grow per-email throttle rows by rotating input");
} finally {
  console.info = originalInfo;
  process.env = originalEnv;
  delete (globalThis as Record<string, unknown>).__aistDb;
  await client.close();
}
console.log("ALL SECURITY CHECKS PASSED");
