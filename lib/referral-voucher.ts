/**
 * Referral Voucher, Design 1 · Classic (owner, 10 Nov 2026): the trainees one partner (Agency, Consultancy or
 * Freelance) endorsed in a period, with the date enrolled, course and rebate, and the total. Issued once and
 * kept as a snapshot (202610290088).
 */
export type ReferralVoucherRow = { enrolledOn: string; trainee: string; courseCode: string; course: string; rebateCentavos: number; rebateId?: string } & Partial<LineFacts>;
/** Detailed lines (owner, 13 Nov 2026): the enrollment, its fee, what was paid, the last receipt and when. */
export type LineFacts = { enrollmentNo: string; feeCentavos: number; paidCentavos: number; receipt: string | null; paidOn: string | null };
export const paidInFull = (r: Partial<LineFacts>) => r.feeCentavos != null && r.paidCentavos != null && r.feeCentavos > 0 && r.paidCentavos >= r.feeCentavos;

/** What Accounting checks before approving: who is not paid in full, who is on another voucher, the payee, and the total. */
export function voucherChecks(v: { rows: ReferralVoucherRow[]; totalCentavos: number; mode?: string; payeeAccount?: string | null; reference?: string | null }, onOtherVoucher: Set<string> = new Set()) {
  const unpaid = v.rows.filter((r) => r.feeCentavos != null && !paidInFull(r));
  const twice = v.rows.filter((r) => r.rebateId && onOtherVoucher.has(r.rebateId));
  const needsPayee = !!v.mode && v.mode !== "Offset at Payment" && v.mode !== "Cash";
  return [
    { ok: !unpaid.length, text: unpaid.length ? `Not paid in full: ${unpaid.map((r) => r.trainee).join(", ")}` : "Every trainee is paid in full" },
    { ok: !twice.length, text: twice.length ? `Also on another voucher: ${twice.map((r) => r.trainee).join(", ")}` : "No trainee is on another voucher" },
    { ok: !needsPayee || !!(v.payeeAccount || v.reference), text: needsPayee ? (v.payeeAccount || v.reference ? `Payee: ${v.payeeAccount || v.reference}` : "No payee account") : `Paid by ${v.mode ?? "Offset at Payment"}; no account needed` },
    { ok: voucherTotal(v.rows) === Number(v.totalCentavos), text: `Lines add up to the total (${v.rows.length} line${v.rows.length === 1 ? "" : "s"})` },
  ];
}
export type ReferralVoucherSnapshot = {
  number: string; issuedOn: string; partner: string; kind: string; referralCode: string | null; contact: string | null;
  from: string; to: string; rows: ReferralVoucherRow[]; totalCentavos: number; preparedBy: string;
  /** Prepared by the Cashier (owner, 10 Nov 2026): how the partner is paid, and the details for it. */
  mode?: string; reference?: string | null; payeeAccount?: string | null;
  /** The Cashier's note to Accounting (13 Nov 2026). */
  note?: string | null;
};
export const VOUCHER_MODES = ["Offset at Payment", "Cash", "GCash", "Bank Transfer"] as const;
export type VoucherStatus = "For Approval" | "Approved" | "Returned" | "Released";
/** The voucher's status is its latest event (202610290091); a voucher with no event yet waits for Accounting. */
export function voucherStatus(events: { status: string; created_at: string }[]): VoucherStatus {
  const last = [...events].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return (last?.status as VoucherStatus | undefined) ?? "For Approval";
}
type One<T> = T | T[] | null | undefined;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
export type RebateForVoucher = {
  id?: string; status: string; rebate_centavos: number;
  enrollments: One<{ created_at: string }>;
  trainees: One<{ legal_first_name: string; legal_middle_name?: string | null; legal_last_name: string }>;
  courses: One<{ code: string; name: string }>;
};

export const manilaDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(iso));

/** The voucher lines: rebates not cancelled, for enrollments made in the period (Manila days), oldest first. */
export function voucherRows(rebates: RebateForVoucher[], from: string, to: string, taken: Set<string> = new Set()): ReferralVoucherRow[] {
  return rebates.flatMap((r) => {
    const e = one(r.enrollments), t = one(r.trainees), c = one(r.courses);
    // A rebate already on a voucher that was not returned is not listed again.
    if (r.status === "Cancelled" || !e || (r.id && taken.has(r.id))) return [];
    const day = manilaDay(e.created_at);
    if (day < from || day > to) return [];
    const trainee = t ? `${t.legal_last_name}, ${[t.legal_first_name, t.legal_middle_name].filter(Boolean).join(" ")}`.toUpperCase() : "TRAINEE";
    return [{ enrolledOn: day, trainee, courseCode: c?.code ?? "", course: c?.name ?? "", rebateCentavos: Number(r.rebate_centavos) || 0, ...(r.id ? { rebateId: r.id } : {}) }];
  }).sort((a, b) => a.enrolledOn.localeCompare(b.enrolledOn) || a.trainee.localeCompare(b.trainee));
}

/**
 * Receipt shows the full fee (owner, 10 Nov 2026: "Pays Less, Receipt Shows Full"): a partner's referral rebate
 * is not printed as "less rebate". The fee due stays the full fee and the rebate counts as paid toward it, so the
 * balance is unchanged; the partner's share is settled through the Referral Voucher.
 */
export const isReferralRebate = (c: { event_type?: string | null; description?: string | null }) => c.event_type === "discount" && /^Referral rebate \(/.test(c.description ?? "");
export const referralRebateTotal = (charges: { event_type?: string | null; description?: string | null; amount_centavos: number | string }[]) => charges.filter(isReferralRebate).reduce((s, c) => s + Number(c.amount_centavos), 0);

export const voucherTotal = (rows: ReferralVoucherRow[]) => rows.reduce((s, r) => s + r.rebateCentavos, 0);
