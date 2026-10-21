/**
 * Copy Trainee Details (owner, 21 Oct 2026): Registration sends a trainee's details
 * to a partnered center when endorsing an enrollment — as labelled text (Messenger,
 * Viber, email) or as tab-separated rows (one per course) for the center's sheet.
 */
export type CopyCourse = { course: string; center: string; date: string };
export type CopyTrainee = { name: string; nwmtaciNo: string; birthDate: string; placeOfBirth: string; srn: string; rank: string; company: string; address: string; mobile: string; email: string; emergency: string; courses: CopyCourse[] };

export const COPY_COLUMNS = ["Full Name", "NWMTACI No.", "Birth Date", "Place of Birth", "SRN", "Rank", "Company", "Address", "Mobile", "Email", "Emergency Contact", "Course", "Center", "Training Date"];

const clean = (v: string) => v.replace(/[\t\r\n]+/g, " ").trim();

export function traineeCopy(t: CopyTrainee) {
  const base: [string, string][] = [["Full Name", t.name], ["NWMTACI No.", t.nwmtaciNo], ["Birth Date", t.birthDate], ["Place of Birth", t.placeOfBirth], ["SRN", t.srn], ["Rank", t.rank], ["Company", t.company], ["Address", t.address], ["Mobile", t.mobile], ["Email", t.email], ["Emergency Contact", t.emergency]];
  const courseLines = t.courses.map((c, i) => `Course${t.courses.length > 1 ? ` ${i + 1}` : ""}: ${[c.course, c.center, c.date].filter(Boolean).join(" · ")}`);
  const text = [...base.filter(([, v]) => v).map(([k, v]) => `${k}: ${clean(v)}`), ...courseLines].join("\n");
  const fields = base.map(([, v]) => clean(v));
  const rows = (t.courses.length ? t.courses : [{ course: "", center: "", date: "" }]).map((c) => [...fields, clean(c.course), clean(c.center), clean(c.date)].join("\t")).join("\n");
  return { text, rows };
}
