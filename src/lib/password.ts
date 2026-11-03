import {
  randomBytes,
  scrypt as scryptCallback,
  type ScryptOptions,
  timingSafeEqual,
} from "node:crypto";

// Hand-rolled rather than `promisify`: promisify resolves to scrypt's 3-arg
// overload and drops the options parameter we need for N/r/p and maxmem.
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

/**
 * scrypt from node:crypto, chosen over bcrypt/argon2 so the project has no
 * native build step — it installs and runs identically on this machine and on
 * a serverless host.
 */
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const PARAMS = { N: 16384, r: 8, p: 1 } as const;

/** Serialized as `scrypt$N$r$p$salt$hash`, so params can change without breaking old rows. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(rawSalt, "base64url");
  const expected = Buffer.from(rawHash, "base64url");

  let derived: Buffer;
  try {
    // Params come from the stored row, so they may exceed the 32MB default
    // maxmem if PARAMS is raised later. Size the budget from them instead.
    derived = await scrypt(password, salt, expected.length, {
      N,
      r,
      p,
      maxmem: 256 * N * r,
    });
  } catch {
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
