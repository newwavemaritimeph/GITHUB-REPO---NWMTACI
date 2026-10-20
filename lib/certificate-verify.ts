import { randomBytes } from "node:crypto";

/**
 * Certificate verification codes (owner's QR plan, 20 Oct 2026): 12 random
 * Crockford Base32 characters (no I, L, O, U), stored without dashes and shown
 * as XXXX-XXXX-XXXX. Random, never the certificate number, so records cannot be
 * guessed in sequence. The QR link format never changes once printed.
 */
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newVerifyCode() {
  const bytes = randomBytes(12);
  return Array.from(bytes, (b) => CROCKFORD[b & 31]).join("");
}

/** Uppercase, dashes and spaces removed; Crockford's look-alikes read as digits (O→0, I/L→1). */
export function normalizeVerifyCode(input: string) {
  const code = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(code) ? code : null;
}

export const formatVerifyCode = (code: string) => code.match(/.{1,4}/g)?.join("-") ?? code;

export const verifyBaseUrl = () => (process.env.CERTIFICATE_VERIFY_BASE_URL || "https://newwavemaritimemtaci.com").replace(/\/+$/, "");
export const verifyUrl = (code: string) => `${verifyBaseUrl()}/verify/${formatVerifyCode(code)}`;
