import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadMismoDay } from "@/lib/mismo-server";
import { balanceAt, finalList, unsettledAt11 } from "@/lib/mismo";

export const runtime = "nodejs";

const longDate = (d: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`));
const peso = (c: number) => `PHP ${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ascii = (s: string) => s.replace(/·/g, "-").normalize("NFKD").replace(/[^\x20-\x7E]/g, "");

/**
 * MARINA MISMO lists as PDF (MISMO Compliance Officer, Admin).
 * list=final: trainees settled by 4:00 PM, for the MARINA MISMO Portal.
 * list=unsettled: trainees not settled as of 11:00 AM, for the instructor.
 */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((r) => ["admin", "mismo_officer"].includes(r))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "", batchId = url.searchParams.get("batch"), list = url.searchParams.get("list") === "unsettled" ? "unsettled" : "final";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const day = await loadMismoDay(db, date);
  const batches = day.batches.filter((b) => !batchId || b.id === batchId);
  if (!batches.length) return NextResponse.json({ error: "No STCW class on this day." }, { status: 404 });

  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.07, 0.25, 0.39), muted = rgb(0.37, 0.44, 0.5), ink = rgb(0.06, 0.15, 0.22), rule = rgb(0.85, 0.89, 0.92);
  const W = 841.89, H = 595.28, M = 32; // A4 landscape
  const unsettled = list === "unsettled";
  const cols = unsettled
    ? [["#", 26], ["Trainee", 250], ["Batch", 120], ["Course", 110], ["Room · instructor", 190], ["Balance at 11:00 AM", 90]] as const
    : [["#", 26], ["Last name", 110], ["First name", 110], ["Middle name", 90], ["Birth date", 70], ["SRN", 110], ["Rank", 80], ["Course", 90], ["Training dates", 92]] as const;
  for (const b of batches) {
    const rows = unsettled ? unsettledAt11(b) : finalList(b);
    let page = pdf.addPage([W, H]);
    let y = H - M;
    const header = () => {
      page.drawText("New Wave Maritime Training and Assessment Center, Inc.", { x: M, y, size: 11, font: bold, color: navy });
      y -= 22;
      page.drawText(ascii(unsettled ? "Trainees not settled as of 11:00 AM" : "MARINA MISMO - list of trainees"), { x: M, y, size: 17, font: bold, color: ink });
      y -= 16;
      page.drawText(ascii(`${b.batchNumber} · ${b.courseName} (${b.courseCode}) · ${b.startsOn === b.endsOn ? b.startsOn : `${b.startsOn} to ${b.endsOn}`}`), { x: M, y, size: 10, font: reg, color: muted });
      y -= 13;
      page.drawText(ascii(`${longDate(date)} · Room: ${b.room ?? "-"} · Instructor: ${b.instructor ?? "-"} · ${unsettled ? "please send these trainees to the Cashier" : "settled by 4:00 PM"}`), { x: M, y, size: 10, font: reg, color: muted });
      y -= 18;
      page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: navy });
      let x = M + 5;
      for (const [label, w] of cols) { page.drawText(label, { x, y, size: 8.5, font: bold, color: rgb(1, 1, 1) }); x += w; }
      y -= 22;
    };
    header();
    rows.forEach((t, i) => {
      if (y < M + 70) { page = pdf.addPage([W, H]); y = H - M; header(); }
      const cells = unsettled
        ? [String(i + 1), `${t.lastName}, ${t.firstName}${t.middleName ? ` ${t.middleName}` : ""}`, b.batchNumber, b.courseCode, `${b.room ?? "-"} · ${b.instructor ?? "-"}`, peso(balanceAt(t, "11"))]
        : [String(i + 1), t.lastName, t.firstName, t.middleName ?? "-", t.birthdate ?? "-", t.srn ?? "-", t.rank ?? "-", b.courseCode, b.startsOn === b.endsOn ? b.startsOn : `${b.startsOn.slice(5)} to ${b.endsOn.slice(5)}`];
      let x = M + 5;
      cells.forEach((c, k) => {
        const w = cols[k][1] - 6;
        let text = ascii(c);
        while (text.length > 1 && reg.widthOfTextAtSize(text, 9) > w) text = text.slice(0, -1);
        page.drawText(text, { x, y, size: 9, font: k === 1 ? bold : reg, color: ink });
        x += cols[k][1];
      });
      page.drawLine({ start: { x: M, y: y - 5 }, end: { x: W - M, y: y - 5 }, thickness: 0.5, color: rule });
      y -= 17;
    });
    if (!rows.length) { page.drawText(unsettled ? "Everyone in this class had settled by 11:00 AM." : "No trainee settled by 4:00 PM.", { x: M + 5, y, size: 10, font: reg, color: muted }); y -= 17; }
    y -= 6;
    page.drawText(ascii(`${rows.length} trainee${rows.length === 1 ? "" : "s"}${unsettled ? "" : ` · ${b.trainees.length - rows.length} left off (balance unpaid at 4:00 PM)`}`), { x: M, y, size: 9.5, font: bold, color: ink });
    const sy = Math.max(M + 24, y - 54);
    page.drawLine({ start: { x: M, y: sy }, end: { x: M + 220, y: sy }, thickness: 0.8, color: ink });
    page.drawText(unsettled ? "Prepared by - MISMO Compliance Officer" : "Prepared by - MISMO Compliance Officer", { x: M, y: sy - 12, size: 9, font: reg, color: muted });
    page.drawLine({ start: { x: W - M - 220, y: sy }, end: { x: W - M, y: sy }, thickness: 0.8, color: ink });
    page.drawText(unsettled ? "Received by - Instructor" : "Noted by - Admin", { x: W - M - 220, y: sy - 12, size: 9, font: reg, color: muted });
  }
  await db.from("audit_logs").insert({ actor_id: staff.user.id, actor_role: "mismo_officer", action: "report.exported", record_type: "mismo_list", record_id: `${date}:${batchId ?? "all"}`, new_values: { list } });
  return new Response(Buffer.from(await pdf.save()), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="mismo-${list}-${date}.pdf"`, "cache-control": "no-store" } });
}
