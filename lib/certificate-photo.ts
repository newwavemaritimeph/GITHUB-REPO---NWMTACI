/**
 * Certificate 2x2 photo rules (owner, 9 Oct 2026), shared by the browser and
 * the server: the file is named after the portal's registered name, course,
 * batch and date, and the background must look white.
 */

/** Target size: 2 in × 2 in at 300 dpi. */
export const PHOTO_SIZE = 600;
/** Largest file kept after resizing. */
export const PHOTO_MAX_BYTES = 500 * 1024;

/** "DELA CRUZ, JUAN P - UBT-PSSR - BCH-2026-0412 - 2026-10-10.jpg" */
export function photoFileName(p: { lastName: string; firstName: string; middleName?: string | null; courseCode: string; batchNumber?: string | null; date: string }) {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  const middle = (p.middleName ?? "").trim();
  const name = `${clean(p.lastName).toUpperCase()}, ${clean(p.firstName).toUpperCase()}${middle ? ` ${clean(middle).charAt(0).toUpperCase()}` : ""}`;
  const parts = [name, clean(p.courseCode).toUpperCase(), p.batchNumber ? clean(p.batchNumber).toUpperCase() : "", p.date].filter(Boolean);
  return `${parts.join(" - ").slice(0, 180)}.jpg`;
}

/**
 * Whether the photo's background looks white: the outer border (8% of each
 * side) must be mostly bright, low-colour pixels. `rgba` is canvas ImageData.
 */
export function whiteBackground(rgba: ArrayLike<number>, width: number, height: number) {
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.08));
  let total = 0, white = 0;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 200));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (x >= band && x < width - band && y >= band && y < height - band) continue;
      const i = (y * width + x) * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      total++;
      if (Math.min(r, g, b) >= 215 && Math.max(r, g, b) - Math.min(r, g, b) <= 30) white++;
    }
  }
  const whiteShare = total ? white / total : 0;
  return { ok: whiteShare >= 0.85, whiteShare };
}

/** Certificate fields an Admin may correct. */
export type CertificateCorrections = { name?: string; courseName?: string; batchLabel?: string; startsOn?: string; endsOn?: string; issuedOn?: string; reason?: string };

/** The value that prints: the Admin's correction when there is one, else the portal value. */
export function corrected<T extends string | null>(portal: T, correction?: string | null): T | string {
  return correction && correction.trim() ? correction.trim() : portal;
}
