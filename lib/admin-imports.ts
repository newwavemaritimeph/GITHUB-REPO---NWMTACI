/**
 * One-time Admin imports (owner, 20 Oct 2026): the last certificate number used
 * per course (from a Google Sheet) and the Google Classroom link and class code
 * per course or batch. Pure parsing and matching, shared by the screens and tests.
 */
export type CourseRef = { id: string; code: string; name: string };
export type BatchRef = { id: string; course_id: string; starts_on: string };

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/** A Google Sheet link → its CSV export link (keeps the tab), or null. */
export function sheetCsvUrl(url: string) {
  const m = url.trim().match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (!m) return null;
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
}

/** "HPT-00149" → prefix HPT-, 149, 5 digits; "149" → number only. */
export function parseLastCertificateNo(raw: string) {
  const s = raw.trim();
  const m = s.match(/^(.*?)(\d+)\s*$/);
  if (!m) return null;
  return { prefix: m[1], number: Number(m[2]), pad: m[2].length };
}

/** Course by code (one match), else by exact name; the ILO catering courses share the code ILO. */
export function matchCourse(courses: CourseRef[], code: string, name: string) {
  const c = norm(code), n = norm(name);
  const byCode = c ? courses.filter((x) => norm(x.code) === c) : [];
  if (byCode.length === 1) return byCode[0];
  return courses.find((x) => n && norm(x.name) === n) ?? byCode[0] ?? null;
}

/** Sheet rows → {code, name, last}: columns found by header (Code / Course / Last…), else the first three. */
export function readNumberRows(rows: string[][]) {
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const has = head.some((h) => /last|number|code|course/.test(h));
  const col = (re: RegExp, fallback: number) => { const i = head.findIndex((h) => re.test(h)); return i >= 0 ? i : fallback; };
  const ic = col(/code/, 0), iname = col(/course|name|title/, 1), ilast = col(/last|number|cert/, 2);
  return (has ? rows.slice(1) : rows).map((r) => ({ code: (r[ic] ?? "").trim(), name: (r[iname] ?? "").trim(), last: (r[ilast] ?? "").trim() })).filter((r) => (r.code || r.name) && r.last);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A pasted table of Classroom links (tabs or commas, any column order): each line with a
 * classroom.google.com link, its class code, and the course code or name. "CCMD0081 (Oct 19-21, 2026)"
 * style names also give the batch start date.
 */
export function parseClassroomLines(text: string) {
  return text.split(/\r?\n/).map((line) => {
    // Tabs when pasted from a table or sheet (names like "CCMD0081 (Oct 19-21, 2026)" keep their comma); else CSV commas.
    const cells = line.split(line.includes("\t") ? /\t/ : /,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, "").trim()).filter(Boolean);
    const link = cells.find((c) => /^https?:\/\/classroom\.google\.com\//i.test(c)) ?? null;
    if (!link) return null;
    const rest = cells.filter((c) => c !== link && !/^\d+$/.test(c) && !/^open$/i.test(c));
    // Class codes are 6–9 lowercase letters or digits; course codes are uppercase.
    const classCode = [...rest].reverse().find((c) => /^[a-z0-9]{6,9}$/.test(c) && /[a-z]/.test(c)) ?? null;
    const words = rest.filter((c) => c !== classCode);
    const code = words.find((c) => /^[A-Z0-9][A-Z0-9_-]{1,14}$/.test(c)) ?? "";
    const name = words.filter((c) => c !== code).sort((a, b) => b.length - a.length)[0] ?? "";
    const d = `${code} ${name}`.match(/\(([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\s*[-–]\s*\d{1,2},?\s*(\d{4})\)/);
    const startsOn = d && MONTHS.includes(d[1].toLowerCase()) ? `${d[3]}-${String(MONTHS.indexOf(d[1].toLowerCase()) + 1).padStart(2, "0")}-${d[2].padStart(2, "0")}` : null;
    return { link: link.split("?")[0], classCode, code, name, startsOn };
  }).filter((r): r is NonNullable<typeof r> => !!r);
}

/** A table copied from a web page or sheet (clipboard HTML) → tab-separated lines, keeping each link address ("Open" → its URL). */
export function htmlTableToLines(html: string) {
  const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  return [...html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((tr) => [...tr[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((c) => c[1].match(/href="([^"]+)"/i)?.[1]?.replace(/&amp;/g, "&") ?? strip(c[1])).join("\t")).join("\n");
}

/** Batch-class lines ("CCMD0081 …") go to the batch of that course starting on the date in the name. */
export function matchClassroomLine(line: ReturnType<typeof parseClassroomLines>[number], courses: CourseRef[], batches: BatchRef[]) {
  if (line.startsOn) {
    const prefix = norm(line.code || line.name).match(/^[A-Z]+/)?.[0] ?? "";
    const course = courses.find((c) => norm(c.code).startsWith(prefix) && prefix.length >= 3) ?? null;
    const batch = course ? batches.find((b) => b.course_id === course.id && b.starts_on === line.startsOn) ?? null : null;
    return { course, batch };
  }
  const nameOnly = line.name.replace(/^[A-Z0-9_-]+\s*[-_]\s*/, "");
  return { course: matchCourse(courses, line.code || line.name.split(/[-_\s]/)[0], nameOnly), batch: null };
}
