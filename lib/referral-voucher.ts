/**
 * Referral Voucher, Design 1 · Classic (owner, 10 Nov 2026): the trainees one partner (Agency, Consultancy or
 * Freelance) endorsed in a period, with the date enrolled, course and rebate, and the total. Issued once and
 * kept as a snapshot (202610290088).
 */
export type ReferralVoucherRow = { enrolledOn: string; trainee: string; courseCode: string; course: string; rebateCentavos: number };
export type ReferralVoucherSnapshot = {
  number: string; issuedOn: string; partner: string; kind: string; referralCode: string | null; contact: string | null;
  from: string; to: string; rows: ReferralVoucherRow[]; totalCentavos: number; preparedBy: string;
};
type One<T> = T | T[] | null | undefined;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
export type RebateForVoucher = {
  status: string; rebate_centavos: number;
  enrollments: One<{ created_at: string }>;
  trainees: One<{ legal_first_name: string; legal_middle_name?: string | null; legal_last_name: string }>;
  courses: One<{ code: string; name: string }>;
};

export const manilaDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(iso));

/** The voucher lines: rebates not cancelled, for enrollments made in the period (Manila days), oldest first. */
export function voucherRows(rebates: RebateForVoucher[], from: string, to: string): ReferralVoucherRow[] {
  return rebates.flatMap((r) => {
    const e = one(r.enrollments), t = one(r.trainees), c = one(r.courses);
    if (r.status === "Cancelled" || !e) return [];
    const day = manilaDay(e.created_at);
    if (day < from || day > to) return [];
    const trainee = t ? `${t.legal_last_name}, ${[t.legal_first_name, t.legal_middle_name].filter(Boolean).join(" ")}`.toUpperCase() : "TRAINEE";
    return [{ enrolledOn: day, trainee, courseCode: c?.code ?? "", course: c?.name ?? "", rebateCentavos: Number(r.rebate_centavos) || 0 }];
  }).sort((a, b) => a.enrolledOn.localeCompare(b.enrolledOn) || a.trainee.localeCompare(b.trainee));
}

export const voucherTotal = (rows: ReferralVoucherRow[]) => rows.reduce((s, r) => s + r.rebateCentavos, 0);
