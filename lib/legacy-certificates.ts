/** Reading a certificate log spreadsheet (CSV) for certificates issued before the portal (owner, 9 Oct 2026). */

export type LegacyRow = { traineeName: string; nwmtaciNumber: string; courseCode: string; certificateNumber: string; registrationNumber: string; issuedOn: string };
export type ImportResult = { traineeName: string; certificateNumber: string; ok: boolean; matched: boolean; message: string };

/** Splits CSV text into rows, handling quoted fields with commas and quotes. */
export function parseCsv(text: string) {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch; continue; }
    if (ch === '"') quoted = true; else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}
/** "2026-09-30", "9/30/2026" or "30-Sep-2026" → "2026-09-30"; "" when unreadable. */
export function isoDate(v: string) {
  const s = v.trim(); if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(s); return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(d);
}
/** Maps a spreadsheet to rows by its header names (Trainee, NWMTACI No., Course, Certificate No., Registration No., Date Issued). */
export function legacyRowsFromCsv(text: string): { rows: LegacyRow[]; missing: string[] } {
  const all = parseCsv(text); if (!all.length) return { rows: [], missing: ["header"] };
  const head = all[0].map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const col = (...keys: string[]) => head.findIndex((h) => keys.some((k) => h.includes(k)));
  const c = { name: col("trainee", "name"), app: col("nwmtaci", "enrollment"), course: col("course"), cert: col("certificate"), reg: col("registration"), date: col("date", "issued") };
  const missing = Object.entries({ "Trainee": c.name, "Course": c.course }).filter(([, i]) => i < 0).map(([k]) => k);
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  return { missing, rows: all.slice(1).map((r) => ({ traineeName: at(r, c.name), nwmtaciNumber: at(r, c.app), courseCode: at(r, c.course), certificateNumber: at(r, c.cert), registrationNumber: at(r, c.reg), issuedOn: isoDate(at(r, c.date)) })).filter((r) => r.traineeName.length >= 2) };
}

