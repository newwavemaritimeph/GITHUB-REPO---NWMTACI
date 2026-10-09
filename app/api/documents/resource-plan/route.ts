import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { planRows, type PlanBatch } from "@/lib/admin-assistant";

export const runtime = "nodejs";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const short = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));
const longDay = (d: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T12:00:00+08:00`));
const ascii = (s: string) => s.replace(/[–—]/g, "-").replace(/·/g, "-").normalize("NFKD").replace(/[^\x20-\x7E]/g, "");

/**
 * Resource plan as PDF (owner, 9 Oct 2026): batches from `from` to `to`
 * grouped by start day, with classroom, students, instructor and notes
 * (missing, over capacity, accreditation, double bookings). A4 landscape.
 */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((r) => ["admin", "admin_assistant"].includes(r))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const from = url.searchParams.get("from") ?? today, to = url.searchParams.get("to") ?? from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return NextResponse.json({ error: "Invalid date range." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const [batchRes, roomRes, insRes, accRes, planRes] = await Promise.all([
    db.from("batches").select("id,batch_number,course_id,starts_on,ends_on,capacity,confirmed_count,status,classroom_id,courses(code,name)").neq("status", "Cancelled").lte("starts_on", to).gte("ends_on", from).order("starts_on").limit(1000),
    db.from("classrooms").select("id,name,capacity").eq("active", true),
    db.from("instructors").select("id,complete_name"),
    db.from("instructor_accreditations").select("instructor_id,course_id,valid_until"),
    db.from("batch_resources").select("batch_id,classroom_id,instructor_id"),
  ]);
  if (batchRes.error) return NextResponse.json({ error: batchRes.error.message }, { status: 400 });
  const plans = new Map(((planRes.error ? [] : planRes.data) ?? []).map((p) => [p.batch_id as string, p]));
  const batches: PlanBatch[] = (batchRes.data ?? []).map((b) => {
    const c = one(b.courses as unknown as { code: string; name: string } | null);
    const p = plans.get(b.id as string);
    return { id: b.id as string, batchNumber: b.batch_number as string, courseId: b.course_id as string, courseCode: c?.code ?? "", courseName: c?.name ?? "", startsOn: b.starts_on as string, endsOn: b.ends_on as string, students: Number(b.confirmed_count ?? 0), capacity: Number(b.capacity ?? 24), classroomId: (p?.classroom_id as string | null) ?? (b.classroom_id as string | null) ?? null, instructorId: (p?.instructor_id as string | null) ?? null };
  });
  const rows = planRows(batches, (roomRes.data ?? []).map((r) => ({ id: r.id as string, name: r.name as string, capacity: Number(r.capacity) })), (insRes.error ? [] : insRes.data ?? []) as { id: string; complete_name: string }[], (accRes.error ? [] : accRes.data ?? []) as { instructor_id: string; course_id: string; valid_until: string | null }[]);

  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.07, 0.25, 0.39), muted = rgb(0.37, 0.44, 0.5), ink = rgb(0.06, 0.15, 0.22), rule = rgb(0.86, 0.9, 0.93), red = rgb(0.71, 0.14, 0.09), band = rgb(0.93, 0.96, 0.97);
  const W = 841.89, H = 595.28, M = 30;
  const cols = [["Batch", 98], ["Course", 190], ["Dates", 82], ["Classroom", 92], ["Students", 52], ["Instructor", 120], ["Notes", 148]] as const;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const fit = (t: string, w: number, font = reg, size = 8.5) => { let s = ascii(t); while (s.length > 1 && font.widthOfTextAtSize(s, size) > w - 8) s = s.slice(0, -1); return s; };
  const header = () => {
    page.drawText("NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", { x: M, y, size: 8.5, font: bold, color: navy });
    y -= 18;
    page.drawText(ascii(`Resource Plan - ${short(from)} to ${short(to)}, ${to.slice(0, 4)}`), { x: M, y, size: 15, font: bold, color: ink });
    page.drawText(ascii(`${rows.length} batches - ${rows.filter((r) => r.issues.length).length} need attention - printed ${short(today)}`), { x: W - M - 260, y: y + 2, size: 9, font: reg, color: muted });
    y -= 20;
    page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 17, color: navy });
    let x = M;
    for (const [label, w] of cols) { page.drawText(label.toUpperCase(), { x: x + 4, y, size: 7, font: bold, color: rgb(1, 1, 1) }); x += w; }
    y -= 19;
  };
  header();
  let lastDay = "";
  for (const r of rows) {
    const day = r.startsOn < from ? from : r.startsOn;
    if (y < M + 70) { page = pdf.addPage([W, H]); y = H - M; header(); lastDay = ""; }
    if (day !== lastDay) {
      page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 15, color: band });
      page.drawText(ascii(longDay(day)), { x: M + 4, y, size: 8.5, font: bold, color: navy });
      y -= 17;
      lastDay = day;
    }
    const cells = [r.batchNumber, `${r.courseCode} ${r.courseName}`, r.startsOn === r.endsOn ? short(r.startsOn) : `${short(r.startsOn)}-${short(r.endsOn)}`, r.room?.name ?? "-", `${r.students}/${r.room?.capacity ?? r.capacity}`, r.instructor?.complete_name ?? "-", r.issues.join("; ")];
    let x = M;
    cells.forEach((c, i) => { const w = cols[i][1]; const font = i === 0 ? bold : reg; page.drawText(fit(c, w, font), { x: x + 4, y, size: 8.5, font, color: i === 6 ? red : ink }); x += w; });
    page.drawLine({ start: { x: M, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.5, color: rule });
    y -= 16;
  }
  if (!rows.length) { page.drawText("No batches in this range.", { x: M, y, size: 10, font: reg, color: muted }); y -= 16; }
  y = Math.max(y - 36, M + 20);
  const sig = (label: string, x: number) => { page.drawLine({ start: { x, y }, end: { x: x + 220, y }, thickness: 0.7, color: ink }); page.drawText(label, { x, y: y - 12, size: 8.5, font: reg, color: muted }); };
  sig("Prepared by (Admin Assistant)", M);
  sig("Noted by (Admin)", W - M - 220);
  await db.from("audit_logs").insert({ actor_id: staff.user.id, action: "report.exported", record_type: "report", record_id: `resource-plan:${from}:${to}`, new_values: { from, to, batches: rows.length } });
  return new Response(Buffer.from(await pdf.save()), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="resource-plan-${from}-to-${to}.pdf"`, "cache-control": "no-store" } });
}
