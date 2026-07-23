import { normalizeSrn } from "./validation";

/**
 * Duplicate trainee detection.
 *
 * The SRN is the one identifier a seafarer carries between enrollments, so two
 * records sharing one are the same person however their name was typed. Matching
 * on SRN is exact after normalisation — never fuzzy — because merging two real
 * people would be far worse than leaving a duplicate for staff to review.
 */

export type IdentityFields = {
  id: string;
  srn?: string;
  email?: string;
  mobile?: string;
};

/** Records that share a normalised SRN with `candidate`, excluding itself. */
export function findSrnDuplicates<T extends IdentityFields>(candidate: IdentityFields, records: readonly T[]): T[] {
  const srn = normalizeSrn(candidate.srn ?? "");
  if (!srn) return [];
  return records.filter((record) => record.id !== candidate.id && normalizeSrn(record.srn ?? "") === srn);
}

/**
 * A softer signal for staff review: same email or same mobile, but no SRN match.
 * These are surfaced, never merged automatically — people share a household
 * mobile number, and an agency may register several seafarers from one address.
 */
export function findContactDuplicates<T extends IdentityFields>(candidate: IdentityFields, records: readonly T[]): T[] {
  const email = candidate.email?.trim().toLowerCase();
  const mobile = candidate.mobile?.replace(/\D/g, "");
  if (!email && !mobile) return [];
  return records.filter((record) => {
    if (record.id === candidate.id) return false;
    if (findSrnDuplicates(candidate, [record]).length > 0) return false;
    const sameEmail = Boolean(email) && record.email?.trim().toLowerCase() === email;
    const sameMobile = Boolean(mobile) && mobile!.length >= 7 && record.mobile?.replace(/\D/g, "") === mobile;
    return sameEmail || sameMobile;
  });
}

/**
 * Chooses which record survives a merge: the earliest created, so the trainee
 * keeps their original trainee number and the history hanging off it.
 */
export function chooseSurvivor<T extends { id: string; createdAt: string }>(records: readonly T[]): T | undefined {
  return [...records].sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
}

/**
 * Fills gaps in the survivor from a duplicate. Existing values always win — a
 * merge must never overwrite information staff have already confirmed.
 */
export function mergeInto<T extends Record<string, unknown>>(survivor: T, duplicate: T, fields: readonly (keyof T)[]): T {
  const merged = { ...survivor };
  for (const field of fields) {
    const current = merged[field];
    const incoming = duplicate[field];
    const isBlank = current === undefined || current === null || current === "";
    if (isBlank && incoming !== undefined && incoming !== null && incoming !== "") {
      merged[field] = incoming;
    }
  }
  return merged;
}
