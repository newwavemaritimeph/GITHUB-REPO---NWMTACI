import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { bsNumber } from "@/lib/billing-statement";
import { PrintControls } from "../../admission-record/[id]/print-controls";
import { inWords } from "../../payment-receipt/[id]/receipt-sheets";
import "../../admission-record/[id]/admission-record.css";
import "../../payment-receipt/[id]/receipt.css";

/**
 * Acknowledgement Receipt for a company's Billing Statement payment (owner, 29 Oct 2026):
 * one receipt to the partner listing every trainee it paid for, original and duplicate on
 * one 8.5 × 13 sheet. Each trainee also keeps their own receipt number.
 */
export const dynamic = "force-dynamic";

const ORG = "NEW WAVE MARITIME TRAINING AND ASSESSMENT CENTER, INC.";
const ADDRESS = "Room 103, Bel-Air Apartment, 1020 Roxas Boulevard, Ermita, Manila 1000 · +63 948 847 6530 · (02) 8553 0310 · newwavemaritime@gmail.com · facebook.com/newwavemtc";
const peso = (c: number) => "₱" + (c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const longDay = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export default async function CompanyReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(["admin", "cashier", "accounting"]);
  if (!staff) redirect("/staff-login");
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data: cp } = await db.from("company_payments").select("id,billing_statement_id,amount_centavos,method,reference_number,received_at,payment_ids,recorded_by").eq("id", id).maybeSingle();
  if (!cp) notFound();
  const [{ data: bs }, { data: pays }, { data: receipts }, { data: cashier }] = await Promise.all([
    db.from("billing_statements").select("bs_number,bill_to,coverage_from,coverage_to,total_centavos").eq("id", cp.billing_statement_id).maybeSingle(),
    db.from("payments").select("id,payment_number,amount_centavos,trainees(legal_first_name,legal_last_name),payment_allocations(enrollments(enrollment_number,courses(code)))").in("id", (cp.payment_ids as string[]).length ? cp.payment_ids : ["00000000-0000-0000-0000-000000000000"]),
    db.from("receipts").select("payment_id,receipt_number").in("payment_id", (cp.payment_ids as string[]).length ? cp.payment_ids : ["00000000-0000-0000-0000-000000000000"]),
    cp.recorded_by ? db.from("profiles").select("complete_name").eq("id", cp.recorded_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!bs) notFound();
  const receiptOf = new Map((receipts ?? []).map((r) => [r.payment_id as string, r.receipt_number as string]));
  const lines = (pays ?? []).map((p) => {
    const t = one(p.trainees as unknown as { legal_first_name: string; legal_last_name: string } | null);
    const courses = ((p.payment_allocations ?? []) as unknown as { enrollments: unknown }[]).map((a) => one(one(a.enrollments as { courses: unknown } | null)?.courses as { code: string } | null)?.code).filter(Boolean).join(", ");
    return { id: p.id as string, name: t ? `${t.legal_last_name}, ${t.legal_first_name}`.toUpperCase() : "—", courses, receipt: receiptOf.get(p.id as string) ?? (p.payment_number as string), amount: Number(p.amount_centavos) };
  });
  const bsNo = bsNumber(Number(bs.bs_number));
  const received = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(new Date(cp.received_at as string));
  const content = <>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <div className="tar-letter"><img src="/brand/new-wave-emblem.png" alt="" width={34} height={34} /><div><b>{ORG}</b><span>{ADDRESS}</span></div><i /></div>
    <div className="tar-title"><div><b>ACKNOWLEDGEMENT RECEIPT</b> <span>· company payment · {received}</span></div><div><span>BS NO. </span><strong>{bsNo}</strong></div></div>
    <table className="tar-grid"><tbody>
      <tr><th>Received From</th><td colSpan={3}><b>{bs.bill_to}</b></td><th>Billing Coverage</th><td><b>{longDay(bs.coverage_from as string)} – {longDay(bs.coverage_to as string)}</b></td></tr>
      <tr><th>Mode of Payment</th><td><b>{cp.method}</b></td><th>Reference no.</th><td className="mono">{cp.reference_number || "—"}</td><th>Amount Received</th><td className="b">{peso(Number(cp.amount_centavos))}</td></tr>
      <tr><td colSpan={6}><span className="dim">Amount in words:</span> <b>{inWords(Number(cp.amount_centavos))}</b></td></tr>
    </tbody></table>
    <div className="tar-h">APPLIED TO</div>
    <table className="tar-table"><thead><tr><th>Trainee</th><th>Training</th><th>Trainee Receipt no.</th><th className="r">Amount</th></tr></thead><tbody>
      {lines.map((l) => <tr key={l.id}><td><b>{l.name}</b></td><td>{l.courses}</td><td className="mono">{l.receipt}</td><td className="r b">{peso(l.amount)}</td></tr>)}
      <tr className="b"><td colSpan={3}>Total · {lines.length} trainee{lines.length === 1 ? "" : "s"}</td><td className="r">{peso(lines.reduce((s, l) => s + l.amount, 0))}</td></tr>
    </tbody></table>
    <div className="tar-sigs">{[["Cashier", (cashier as { complete_name?: string } | null)?.complete_name ?? ""], ["Received by (company)", ""]].map(([label, n]) => <div key={label}><span>{n}</span><small>{label}</small></div>)}</div>
  </>;
  return <main className="tar-screen">
    <PrintControls arNumber={`BS-${bsNo}`} title="Company Acknowledgement Receipt" />
    <section className="tar-legal ar-13">
      {[["ORIGINAL COPY", "Company"], ["DUPLICATE COPY", "Office File"]].map(([label, holder]) => <div className="tar-copy" key={label}><div className="tar-sheet"><span className="tar-copy-tag"><b>{label}</b> · {holder}</span>{content}</div></div>)}
    </section>
  </main>;
}
