import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ReceiptSheets } from "./receipt-sheets";
import "../../admission-record/[id]/admission-record.css";

/**
 * Acknowledgement receipt for one payment, in the Training Admission Record
 * layout (owner, 7 Oct 2026): New Wave letterhead, receipt number, the trainee,
 * the payment (mode, reference, amount), the courses it was applied to, the
 * account balance after it, and signatures — original and duplicate on one
 * legal sheet. Amounts come from the payment and its allocations; the receipt
 * number is the one issued with the payment (receipts table).
 */

export const dynamic = "force-dynamic";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const manila = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", ...opts });
const dayOf = (iso: string) => new Date(`${iso}T00:00:00+08:00`);
function trainingDates(start?: string | null, end?: string | null) {
  if (!start) return "No batch yet";
  const d = manila({ day: "numeric" }), m = manila({ month: "short" });
  const s = dayOf(start), e = dayOf(end ?? start);
  if (start === (end ?? start)) return `${d.format(s)} ${m.format(s)}`;
  return `${d.format(s)}${start.slice(0, 7) === (end ?? start).slice(0, 7) ? "" : ` ${m.format(s)}`}–${d.format(e)} ${m.format(e)}`;
}


type BatchRow = { starts_on: string; ends_on: string };

export default async function PaymentReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["admin", "cashier", "accounting"]);
  if (!staff) redirect("/staff-login");
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const { data: payment } = await db.from("payments").select("id,payment_number,trainee_id,amount_centavos,method,receiving_account,reference_number,received_at,verification_state,valid,cashier_id,remarks").eq("id", id).maybeSingle();
  if (!payment) notFound();
  const [traineeRes, receiptRes, allocRes, cashierRes] = await Promise.all([
    db.from("trainees").select("trainee_number,legal_first_name,legal_middle_name,legal_last_name,suffix,srn,rank,mobile,company,application_number").eq("id", payment.trainee_id).maybeSingle(),
    db.from("receipts").select("receipt_number").eq("payment_id", id).maybeSingle(),
    db.from("payment_allocations").select("enrollment_id,amount_centavos").eq("payment_id", id),
    payment.cashier_id ? db.from("profiles").select("complete_name").eq("id", payment.cashier_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const t = traineeRes.data;
  if (!t) notFound();
  const enrollmentIds = (allocRes.data ?? []).map((a) => a.enrollment_id as string);

  // Each enrollment this payment covers, with its balance after all valid payments.
  const [enrollRes, chargeRes, paidRes] = enrollmentIds.length ? await Promise.all([
    db.from("enrollments").select("id,enrollment_number,selling_price_centavos,courses(code,name),batches(starts_on,ends_on)").in("id", enrollmentIds),
    db.from("enrollment_charges").select("enrollment_id,amount_centavos,event_type").in("enrollment_id", enrollmentIds).eq("valid", true),
    db.from("payment_allocations").select("enrollment_id,amount_centavos,payments!inner(valid)").in("enrollment_id", enrollmentIds).eq("payments.valid", true),
  ]) : [{ data: [] }, { data: [] }, { data: [] }];
  const appliedTo = (enrollRes.data ?? []).map((e) => {
    const c = one(e.courses as { code: string; name: string } | { code: string; name: string }[] | null), b = one(e.batches as unknown as BatchRow | BatchRow[] | null);
    const charges = (chargeRes.data ?? []).filter((x) => x.enrollment_id === e.id);
    const due = Number(e.selling_price_centavos) + charges.filter((x) => x.event_type !== "discount").reduce((s, x) => s + Number(x.amount_centavos), 0) - charges.filter((x) => x.event_type === "discount").reduce((s, x) => s + Number(x.amount_centavos), 0);
    const paid = (paidRes.data ?? []).filter((x) => x.enrollment_id === e.id).reduce((s, x) => s + Number(x.amount_centavos), 0);
    const applied = (allocRes.data ?? []).filter((a) => a.enrollment_id === e.id).reduce((s, a) => s + Number(a.amount_centavos), 0);
    return { id: e.id, number: e.enrollment_number as string, code: c?.code ?? "", name: c?.name ?? "Course", dates: trainingDates(b?.starts_on, b?.ends_on), due, paid, applied, balance: Math.max(0, due - paid) };
  });
  const totalDue = appliedTo.reduce((s, r) => s + r.due, 0), totalPaid = appliedTo.reduce((s, r) => s + r.paid, 0), balance = Math.max(0, totalDue - totalPaid);
  const status = !payment.valid ? "VOID" : totalDue > 0 && totalPaid >= totalDue ? "FULLY PAID" : "PARTIALLY PAID";
  const receiptNo = receiptRes.data?.receipt_number ?? payment.payment_number;
  const name = `${t.legal_last_name}, ${[t.legal_first_name, t.legal_middle_name, t.suffix].filter(Boolean).join(" ")}`.toUpperCase();
  const received = manila({ dateStyle: "medium", timeStyle: "short" }).format(new Date(payment.received_at));
  const cashier = (cashierRes.data as { complete_name?: string } | null)?.complete_name ?? "";

  return <ReceiptSheets {...({ receiptNo, name, received, payment: { number: payment.payment_number, method: payment.method, reference: payment.reference_number, amount: Number(payment.amount_centavos), remarks: payment.remarks }, trainee: { appNo: t.application_number ?? t.trainee_number, srn: t.srn, rank: t.rank, mobile: t.mobile, company: t.company }, appliedTo, totalDue, totalPaid, balance, status, cashier })} />;
}
