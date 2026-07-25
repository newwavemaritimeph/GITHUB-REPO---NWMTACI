import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Step-up MFA for privileged staff. Roles in this list must clear a second factor
 * (TOTP via Supabase, or an emailed one-time code) before reaching the portal.
 * Names must match the `roles.name` values in the database exactly.
 */
export const MFA_ENFORCED_ROLES = ["Admin", "Accounting Manager"] as const;

export function isMfaEnforced(roleNames: string[]): boolean {
  return roleNames.some((name) => (MFA_ENFORCED_ROLES as readonly string[]).includes(name));
}

/**
 * Master switch. MFA enforcement stays OFF until deliberately enabled with
 * `MFA_ENFORCED=true`, so nobody is locked out before they have enrolled a factor
 * (and, for email codes, before Resend is configured).
 */
export function mfaEnforcementEnabled(): boolean {
  return process.env.MFA_ENFORCED === "true";
}

export const MFA_COOKIE = "nw_mfa_ok";
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000; // code valid 10 minutes
export const EMAIL_COOKIE_TTL_MS = 8 * 60 * 60 * 1000; // "passed" for 8 hours
export const EMAIL_MAX_ATTEMPTS = 5;
export const EMAIL_MAX_REQUESTS_PER_HOUR = 5;

/** Server-only secret for hashing codes and signing the MFA cookie. */
function mfaSecret(): string {
  const secret = process.env.MFA_COOKIE_SECRET || process.env.SCHEDULED_JOB_SECRET;
  if (!secret) throw new Error("MFA secret is not configured (set MFA_COOKIE_SECRET or SCHEDULED_JOB_SECRET).");
  return secret;
}

/** A 6-digit numeric code, cryptographically random, zero-padded. */
export function generateEmailCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Deterministic hash of a code, bound to the user so codes are not portable. */
export function hashEmailCode(userId: string, code: string): string {
  return createHmac("sha256", mfaSecret()).update(`${userId}:${code}`).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

export function verifyEmailCode(userId: string, code: string, storedHash: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return safeEqualHex(hashEmailCode(userId, code), storedHash);
}

/** Signed cookie value proving this user cleared email MFA, valid until `expiresAt`. */
export function signMfaCookie(userId: string, expiresAtMs: number): string {
  const payload = `${userId}.${expiresAtMs}`;
  const sig = createHmac("sha256", mfaSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

/** True when `value` is a valid, unexpired MFA cookie for `userId`. */
export function verifyMfaCookie(value: string | undefined, userId: string): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [cookieUser, expiresRaw, sig] = parts;
  if (cookieUser !== userId) return false;
  const expiresAtMs = Number(expiresRaw);
  if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return false;
  const expected = createHmac("sha256", mfaSecret()).update(`${cookieUser}.${expiresRaw}`).digest("hex");
  return safeEqualHex(sig, expected);
}
