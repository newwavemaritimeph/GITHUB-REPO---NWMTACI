import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PrintControls } from "./print-controls";
import "./admission-record.css";

/**
 * Training Admission Record (Oct 2026, "Design 01 · classic official").
 * One side of half a short bond sheet (8.5 × 5.5 in): the trainee's admission
 * slip and acknowledgement receipt with its AR number, every active course,
 * fees including miscellaneous charges, each payment received, and the terms
 * and conditions. Amounts are read live; the AR number comes from
 * admission_records (migration 202610070006), so a reprint keeps it.
 */

export const dynamic = "force-dynamic";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const peso = (c: number) => "₱" + (c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const manila = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", ...opts });
const dayOf = (iso: string) => new Date(`${iso}T00:00:00+08:00`);
function trainingDates(start?: string | null, end?: string | null) {
  if (!start) return "No batch yet";
  const d = manila({ day: "numeric" }), m = manila({ month: "short" }), w = manila({ weekday: "short" });
  const s = dayOf(start), e = dayOf(end ?? start);
  if (start === (end ?? start)) return `${d.format(s)} ${m.format(s)} (${w.format(s)})`;
  const sameMonth = start.slice(0, 7) === (end ?? start).slice(0, 7);
  return `${d.format(s)}${sameMonth ? "" : ` ${m.format(s)}`}–${d.format(e)} ${m.format(e)} (${w.format(s)}–${w.format(e)})`;
}
const hhmm = (t?: string | null) => (t ? String(Number(t.slice(0, 2))) + t.slice(2, 5) : "");

const TERMS: [string, string][] = [
  ["1. Payment Terms", "Full payment or a minimum of 50% down payment is required upon enrollment. Full payment must be settled before the completion of the training. Full payment is required for a 1-day course of New Wave."],
  ["2. Cancellation Policy", "Enrollment cancellations must be communicated to the Training Center prior to the scheduled training date. Applicable cancellation charges and deductions shall be in accordance with the Refund Policy of the Training Center."],
  ["3. Rescheduling Policy", "Trainees unable to attend a scheduled session for courses of one (1) to two (2) days may request to have their training rescheduled. Rescheduling is subject to slot availability and approval of the Training Center. Applicable reschedule charges and deductions shall be in accordance with the Refund Policy of the Training Center."],
  ["4. Refund Policy", "Refund requests made at least five (5) days before the scheduled training date shall be subject to a Php 350.00 processing fee. Refund requests made within five (5) days before the scheduled training date shall be subject to a deduction of 50% of the course fee plus a Php 250.00 processing fee."],
  ["5. Make-up Class Policy", "Make-up classes are available only for courses of three (3) days or more, subject to schedule availability and approval. Trainees unable to attend a scheduled session due to valid reasons must immediately inform the Training Center. A make-up class fee of Php 350.00 per training day shall be charged."],
  ["6. Issuance of Certificate of Completion", "Certificates of Completion shall be issued only to trainees who have successfully completed all course requirements and settled all outstanding balances."],
  ["7. Miscellaneous", "Miscellaneous fees (such as the training uniform) are part of the total amount due. This record is the trainee's admission slip and acknowledgement receipt; a reprint keeps the same AR number. New Wave Maritime Training and Assessment Center reserves the right to amend, revise, or update these details without prior notice."],
];
const ORG = "NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.";
const ADDRESS = "Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000 · +63 948 847 6530 · (02) 8553 0310 · newwavemaritime@gmail.com · facebook.com/newwavemtc";
const COURSES_ON_FRONT = 6;
type BatchRow = { batch_number: string; starts_on: string; ends_on: string; daily_start: string | null; daily_end: string | null; venue: string | null };
type PaymentRow = { id: string; payment_number: string; received_at: string; method: string; reference_number: string | null; valid: boolean; cashier_id: string | null };

export default async function AdmissionRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["admin", "registration", "cashier", "accounting"]);
  if (!staff) redirect("/staff-login");
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const { data: record } = await db.from("admission_records").select("id,ar_number,trainee_id,enrollment_ids,issued_by,issued_at,last_printed_at").eq("id", id).maybeSingle();
  if (!record) notFound();
  const ids = record.enrollment_ids as string[];

  const [traineeRes, enrollRes, chargeRes, allocRes, officerRes] = await Promise.all([
    db.from("trainees").select("trainee_number,legal_first_name,legal_middle_name,legal_last_name,suffix,srn,rank,mobile,company,application_number").eq("id", record.trainee_id).maybeSingle(),
    db.from("enrollments").select("id,enrollment_number,enrollment_status,selling_price_centavos,created_at,batch_id,courses(code,name),batches(batch_number,starts_on,ends_on,daily_start,daily_end,venue)").in("id", ids),
    db.from("enrollment_charges").select("enrollment_id,description,amount_centavos,event_type,valid").in("enrollment_id", ids).eq("valid", true),
    db.from("payment_allocations").select("enrollment_id,amount_centavos,payments(id,payment_number,received_at,method,reference_number,valid,cashier_id)").in("enrollment_id", ids),
    record.issued_by ? db.from("profiles").select("complete_name").eq("id", record.issued_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const t = traineeRes.data;
  if (!t) notFound();

  // Rooms come from the batch's per-day resource assignments.
  const batchIds = (enrollRes.data ?? []).map((e) => e.batch_id).filter(Boolean) as string[];
  const roomByBatch = new Map<string, string>();
  if (batchIds.length) {
    const { data: dates } = await db.from("batch_training_dates").select("id,batch_id").in("batch_id", batchIds);
    const dateIds = (dates ?? []).map((d) => d.id);
    if (dateIds.length) {
      const [{ data: assigns }, { data: rooms }] = await Promise.all([
        db.from("resource_assignments").select("batch_training_date_id,classroom_id").in("batch_training_date_id", dateIds),
        db.from("classrooms").select("id,name"),
      ]);
      const dateToBatch = new Map((dates ?? []).map((d) => [d.id, d.batch_id as string]));
      const roomName = new Map((rooms ?? []).map((r) => [r.id, r.name as string]));
      for (const a of assigns ?? []) {
        const b = dateToBatch.get(a.batch_training_date_id);
        if (b && !roomByBatch.has(b) && a.classroom_id && roomName.get(a.classroom_id)) roomByBatch.set(b, roomName.get(a.classroom_id)!);
      }
    }
  }

  const courses = (enrollRes.data ?? [])
    .map((e) => { const c = one(e.courses as { code: string; name: string } | { code: string; name: string }[] | null); const b = one(e.batches as unknown as BatchRow | BatchRow[] | null);
      return { id: e.id, code: c?.code ?? "", name: c?.name ?? "Course", start: b?.starts_on ?? null, dates: trainingDates(b?.starts_on, b?.ends_on), time: b ? `${hhmm(b.daily_start) || "8:00"}–${hhmm(b.daily_end) || "17:00"}` : "—", room: (e.batch_id && roomByBatch.get(e.batch_id)) || b?.venue || "To be assigned", fee: Number(e.selling_price_centavos) }; })
    .sort((a, b) => (a.start ?? "9999").localeCompare(b.start ?? "9999"));

  const misc = (chargeRes.data ?? []).filter((c) => c.event_type !== "discount").map((c) => ({ label: c.description as string, amount: Number(c.amount_centavos) }));
  const discounts = (chargeRes.data ?? []).filter((c) => c.event_type === "discount").map((c) => ({ label: c.description as string, amount: Number(c.amount_centavos) }));

  // One line per payment, summing its allocations across the covered enrollments.
  type PayRow = { id: string; number: string; date: string; method: string; ref: string; amount: number; cashierId: string | null };
  const payMap = new Map<string, PayRow>();
  for (const a of allocRes.data ?? []) {
    const p = one(a.payments as unknown as PaymentRow | PaymentRow[] | null);
    if (!p || p.valid === false) continue;
    const row = payMap.get(p.id) ?? { id: p.id, number: p.payment_number, date: p.received_at, method: p.method, ref: p.reference_number || "—", amount: 0, cashierId: p.cashier_id };
    row.amount += Number(a.amount_centavos);
    payMap.set(p.id, row);
  }
  const payments = [...payMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const lastCashierId = payments.at(-1)?.cashierId ?? null;
  const cashier = lastCashierId ? (await db.from("profiles").select("complete_name").eq("id", lastCashierId).maybeSingle()).data?.complete_name ?? "" : "";

  const feesTotal = courses.reduce((s, c) => s + c.fee, 0), miscTotal = misc.reduce((s, m) => s + m.amount, 0), discTotal = discounts.reduce((s, d) => s + d.amount, 0);
  const due = feesTotal + miscTotal - discTotal, paid = payments.reduce((s, p) => s + p.amount, 0), balance = Math.max(0, due - paid);
  const status = due > 0 && paid >= due ? "FULLY PAID" : paid > 0 ? "PARTIALLY PAID" : "UNPAID";
  const name = `${t.legal_last_name}, ${[t.legal_first_name, t.legal_middle_name, t.suffix].filter(Boolean).join(" ")}`.toUpperCase();
  const issued = manila({ dateStyle: "medium", timeStyle: "short" }).format(new Date(record.issued_at));
  const officer = (officerRes.data as { complete_name?: string } | null)?.complete_name ?? "";
  const front = courses.slice(0, COURSES_ON_FRONT), more = courses.slice(COURSES_ON_FRONT);
  const pages = more.length ? 2 : 1;
  const payDate = manila({ day: "numeric", month: "short" });

  const courseRows = (list: typeof courses, offset: number) => list.map((c, i) => <tr key={c.id}><td className="c">{offset + i + 1}</td><td><b>{c.name}</b> <span className="dim">({c.code})</span></td><td className="nw">{c.dates}</td><td className="nw">{c.time}</td><td className="nw">{c.room}</td><td className="r nw">{peso(c.fee)}</td></tr>);
  const header = (page: number) => <>
    <div className="tar-letter"><img src="/brand/new-wave-emblem.png" alt="" width={34} height={34} /><div><b>{ORG}</b><span>{ADDRESS}</span></div><i /></div>
    <div className="tar-title"><div><b>TRAINING ADMISSION RECORD</b> <span>· admission slip and acknowledgement receipt · issued {issued}{pages > 1 ? ` · page ${page} of ${pages}` : ""}</span></div><div><span>AR NO. </span><strong>{record.ar_number}</strong></div></div>
  </>;

  return <main className="tar-screen">
    <PrintControls arNumber={record.ar_number} />
    <section className="tar-sheet">
      {header(1)}
      <table className="tar-grid"><tbody>
        <tr><th>Name</th><td><b>{name}</b></td><th>Enrollment no.</th><td className="mono accent">{t.application_number ?? t.trainee_number}</td><th>SRN</th><td><b>{t.srn ?? "—"}</b></td></tr>
        <tr><th>Rank</th><td><b>{t.rank ?? "—"}</b></td><th>Mobile</th><td><b>{t.mobile ?? "—"}</b></td><th>Company</th><td><b>{t.company || "—"}</b></td></tr>
      </tbody></table>
      <table className="tar-table"><thead><tr><th className="c">#</th><th>Course</th><th>Training dates</th><th>Time</th><th>Room</th><th className="r">Fee</th></tr></thead><tbody>{courseRows(front, 0)}{more.length > 0 && <tr><td colSpan={6} className="dim">+ {more.length} more course{more.length === 1 ? "" : "s"} on page 2</td></tr>}</tbody></table>
      <div className="tar-money">
        <div><div className="tar-h">FEES</div><table className="tar-table"><tbody>
          <tr><td>Training fees ({courses.length} course{courses.length === 1 ? "" : "s"})</td><td className="r">{peso(feesTotal)}</td></tr>
          {misc.map((m, i) => <tr key={`m${i}`}><td>Misc · {m.label}</td><td className="r">{peso(m.amount)}</td></tr>)}
          {discounts.length ? discounts.map((d, i) => <tr key={`d${i}`}><td>Less · {d.label}</td><td className="r">−{peso(d.amount)}</td></tr>) : <tr><td>Discounts</td><td className="r">{peso(0)}</td></tr>}
          <tr className="b"><td>Total amount due</td><td className="r">{peso(due)}</td></tr>
          <tr className="b"><td>Total received</td><td className="r">{peso(paid)}</td></tr>
          <tr className="b"><td>Balance</td><td className={`r${balance > 0 ? " due" : ""}`}>{peso(balance)}</td></tr>
        </tbody></table></div>
        <div><div className="tar-pay-head"><div className="tar-h">PAYMENTS RECEIVED ({payments.length})</div><span className={`tar-stamp ${status === "FULLY PAID" ? "ok" : status === "UNPAID" ? "none" : "part"}`}>{status}</span></div>
          <table className="tar-table"><thead><tr><th>Payment</th><th>Date</th><th>Method</th><th>Reference</th><th className="r">Amount</th></tr></thead><tbody>
            {payments.map((p) => <tr key={p.id}><td className="mono">{p.number}</td><td className="nw">{payDate.format(new Date(p.date))}</td><td>{p.method}</td><td className="mono">{p.ref}</td><td className="r b">{peso(p.amount)}</td></tr>)}
            {!payments.length && <tr><td colSpan={5} className="dim">No payment recorded yet.</td></tr>}
          </tbody></table>
          <div className="tar-sigs">{[["Registration officer", officer], ["Cashier", cashier], ["Trainee", ""]].map(([label, n]) => <div key={label}><span>{n}</span><small>{label}</small></div>)}</div>
        </div>
      </div>
      <div className="tar-terms"><div className="tar-terms-head"><b>TERMS AND CONDITIONS</b><span>Accepted by the trainee at registration. Present this record with a valid ID on the first training day; report by 7:30 AM.</span></div>
        <div className="tar-terms-cols">{TERMS.map(([h, body]) => <p key={h}><b>{h}</b> {body}</p>)}</div></div>
    </section>
    {more.length > 0 && <section className="tar-sheet">
      {header(2)}
      <table className="tar-table"><thead><tr><th className="c">#</th><th>Course</th><th>Training dates</th><th>Time</th><th>Room</th><th className="r">Fee</th></tr></thead><tbody>{courseRows(more, COURSES_ON_FRONT)}</tbody></table>
      <p className="dim tar-cont">Continuation of {record.ar_number} for {name}. Fees, payments and terms are on page 1.</p>
    </section>}
  </main>;
}
