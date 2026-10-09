import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadReconDay } from "@/lib/reconciliation-server";
import { manilaDay, parseChannel } from "@/lib/reconciliation";

export const runtime = "nodejs";

const longDate = (d: string) => new Intl.DateTimeFormat("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${d}T00:00:00+08:00`));
const time = (iso: string) => new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date(iso));
const peso = (c: number) => `PHP ${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ascii = (s: string) => s.normalize("NFKD").replace(/[^\x20-\x7E]/g, "");

/**
 * GCash reconciliation day sheet (owner, 9 Oct 2026): the day's GCash payments
 * with an "In history" tick column, to lay beside the printed GCash history.
 */
export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((r) => ["admin", "admin_assistant", "accounting"].includes(r))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const today = manilaDay(new Date().toISOString());
  const params = new URL(request.url).searchParams;
  const date = params.get("date") ?? today, channel = parseChannel(params.get("channel"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
  const db = createSupabaseAdminClient();
  const day = await loadReconDay(db, date, today, channel);
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.07, 0.25, 0.39), muted = rgb(0.37, 0.44, 0.5), ink = rgb(0.06, 0.15, 0.22), rule = rgb(0.85, 0.89, 0.92), green = rgb(0.04, 0.48, 0.24), red = rgb(0.71, 0.14, 0.09);
  const W = 595.28, H = 841.89, M = 32; // A4 portrait
  const cols = [["#", 22], ["Time", 50], ["Receipt No.", 90], ["Trainee", 150], [`${channel} Ref. No.`, 105], ["Amount", 74], ["In History", 40]] as const;
  const total = day.rows.reduce((s, r) => s + r.amount_centavos, 0);
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const header = () => {
    page.drawText("NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.", { x: M, y, size: 9, font: bold, color: navy });
    y -= 20;
    page.drawText(`${channel} Reconciliation - Day Sheet`, { x: M, y, size: 15, font: bold, color: ink });
    y -= 16;
    page.drawText(ascii(`${longDate(date)}  -  ${day.rows.length} payment${day.rows.length === 1 ? "" : "s"}  -  ${peso(total)}`), { x: M, y, size: 10, font: reg, color: muted });
    y -= 22;
    let x = M;
    page.drawRectangle({ x: M, y: y - 5, width: W - 2 * M, height: 18, color: navy });
    for (const [label, w] of cols) { page.drawText(label.toUpperCase(), { x: x + 4, y, size: 7, font: bold, color: rgb(1, 1, 1) }); x += w; }
    y -= 20;
  };
  header();
  day.rows.forEach((r, i) => {
    if (y < M + 90) { page = pdf.addPage([W, H]); y = H - M; header(); }
    const cells = [String(i + 1), time(r.received_at), r.receipt_number ?? r.payment_number, r.trainee, r.reference_number ?? "-", peso(r.amount_centavos)];
    let x = M;
    cells.forEach((c, k) => {
      const w = cols[k][1];
      let text = ascii(c);
      const font = k === 4 ? bold : reg;
      while (text.length > 1 && font.widthOfTextAtSize(text, 9) > w - 8) text = text.slice(0, -1);
      page.drawText(text, { x: k === 5 ? x + w - 4 - font.widthOfTextAtSize(text, 9) : x + 4, y, size: 9, font, color: ink });
      x += w;
    });
    // Tick box, already ticked when reconciled.
    page.drawRectangle({ x: x + 12, y: y - 2, width: 11, height: 11, borderColor: ink, borderWidth: 0.7 });
    if (r.status === "Reconciled") page.drawText("v", { x: x + 14.5, y: y - 0.5, size: 10, font: bold, color: green });
    if (r.status === "Not in History") page.drawText("x", { x: x + 15, y: y - 0.5, size: 10, font: bold, color: red });
    page.drawLine({ start: { x: M, y: y - 6 }, end: { x: W - M, y: y - 6 }, thickness: 0.5, color: rule });
    y -= 18;
  });
  if (!day.rows.length) { page.drawText(`No ${channel} payments on this day.`, { x: M, y, size: 10, font: reg, color: muted }); y -= 18; }
  y -= 40;
  const sig = (label: string, x: number) => { page.drawLine({ start: { x, y }, end: { x: x + 200, y }, thickness: 0.7, color: ink }); page.drawText(label, { x, y: y - 12, size: 8.5, font: reg, color: muted }); };
  sig("Checked by (Admin Assistant)", M);
  sig("Noted by (Accounting Manager)", W - M - 200);
  await db.from("audit_logs").insert({ actor_id: staff.user.id, action: "report.exported", record_type: "report", record_id: `reconciliation:${channel}:${date}`, new_values: { date, channel, payments: day.rows.length } });
  return new Response(Buffer.from(await pdf.save()), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${channel.toLowerCase()}-reconciliation-${date}.pdf"`, "cache-control": "no-store" } });
}
