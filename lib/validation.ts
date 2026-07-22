/**
 * Field formats required by New Wave registration and trainee records.
 *
 * Every helper normalises before judging, so a trainee may type a number the way
 * they normally write it — "0917 123 4567", "+63 917-123-4567", "(02) 8553 0310"
 * — and still be accepted. Storage always uses one canonical form.
 */

/* ------------------------------------------------------------- phone numbers */

/** Digits only, with a leading "+" preserved so country codes survive. */
function digits(value: string) {
  return value.replace(/[^\d]/g, "");
}

/**
 * Philippine mobile numbers are a 10-digit subscriber number beginning with 9.
 * Accepts 09XXXXXXXXX, +639XXXXXXXXX, 639XXXXXXXXX and bare 9XXXXXXXXX.
 * Returns E.164 (+639XXXXXXXXX) or null when the value is not a PH mobile.
 */
export function normalizePhMobile(value: string): string | null {
  const raw = digits(value ?? "");
  let subscriber: string | null = null;
  if (/^9\d{9}$/.test(raw)) subscriber = raw;
  else if (/^09\d{9}$/.test(raw)) subscriber = raw.slice(1);
  else if (/^639\d{9}$/.test(raw)) subscriber = raw.slice(2);
  else if (/^00639\d{9}$/.test(raw)) subscriber = raw.slice(4);
  return subscriber ? `+63${subscriber}` : null;
}

export function isPhMobile(value: string) {
  return normalizePhMobile(value) !== null;
}

/**
 * Philippine landlines: a 1–3 digit area code plus a subscriber number. Metro
 * Manila (area 2) moved to 8-digit subscriber numbers, provincial areas use 7.
 * Returns E.164 (+63AAXXXXXXXX) or null.
 */
export function normalizePhLandline(value: string): string | null {
  let raw = digits(value ?? "");
  if (raw.startsWith("0063")) raw = raw.slice(4);
  else if (raw.startsWith("63") && raw.length >= 11) raw = raw.slice(2);
  else if (raw.startsWith("0")) raw = raw.slice(1);

  // Metro Manila: area code 2 with an 8-digit subscriber number.
  if (/^2\d{8}$/.test(raw)) return `+63${raw}`;
  // A bare Metro Manila subscriber number, e.g. "8553 0310".
  if (/^[2-9]\d{7}$/.test(raw)) return `+632${raw}`;
  // Provincial: 2–3 digit area code with a 7-digit subscriber number.
  if (/^\d{2,3}\d{7}$/.test(raw) && raw.length >= 9 && raw.length <= 10) return `+63${raw}`;
  return null;
}

export function isPhLandline(value: string) {
  return normalizePhLandline(value) !== null;
}

/** A contact number may be either a PH mobile or a PH landline. */
export function normalizePhContactNumber(value: string): string | null {
  return normalizePhMobile(value) ?? normalizePhLandline(value);
}

export function isPhContactNumber(value: string) {
  return normalizePhContactNumber(value) !== null;
}

/** Display form for a stored E.164 mobile: +639171234567 → 0917 123 4567. */
export function formatPhMobile(value: string) {
  const normalized = normalizePhMobile(value);
  if (!normalized) return value;
  const subscriber = normalized.slice(3);
  return `0${subscriber.slice(0, 3)} ${subscriber.slice(3, 6)} ${subscriber.slice(6)}`;
}

/* ----------------------------------------------------------------------- SRN */

/**
 * The Seafarer's Registration Number is exactly 10 digits. Separators a trainee
 * may copy from a document are ignored; anything else is rejected.
 */
export function normalizeSrn(value: string): string | null {
  const raw = digits(value ?? "");
  const hasOnlySeparators = /^[\d\s-]*$/.test(value ?? "");
  return hasOnlySeparators && raw.length === 10 ? raw : null;
}

export function isSrn(value: string) {
  return normalizeSrn(value) !== null;
}

/* --------------------------------------------------------------------- email */

// Deliberately stricter than a permissive RFC pass: no consecutive, leading or
// trailing dots in either half, and a real TLD of at least two letters.
const EMAIL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export function isEmail(value: string) {
  const trimmed = (value ?? "").trim();
  return trimmed.length <= 254 && EMAIL.test(trimmed);
}

export function normalizeEmail(value: string) {
  return (value ?? "").trim().toLowerCase();
}

/* ------------------------------------------------------------- messages ----- */

export const VALIDATION_MESSAGES = {
  mobile: "Enter a Philippine mobile number, for example 0917 123 4567.",
  contact: "Enter a Philippine mobile or landline number, for example 0917 123 4567 or (02) 8553 0310.",
  srn: "The SRN must be exactly 10 digits.",
  email: "Enter a valid email address, for example name@example.com.",
} as const;
