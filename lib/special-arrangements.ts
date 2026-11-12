/**
 * Special Arrangement fees (owner, 12 Nov 2026). A course can cost more under a special arrangement
 * (Online BT-PSSR for an agency: ₱2,500 instead of ₱900). The Cashier requests it; Accounting or the
 * Admin decide. It is saved as a Pending enrollment charge for the difference (₱1,600), counted in the
 * balance only once approved.
 */
export type SpecialRate = { id: string; course_id: string; arrangement: string; price_centavos: number; active: boolean };
export type SpecialStatus = "Pending" | "Approved" | "Rejected";
export type SpecialRequest = {
  id: string; request_no: string | null; enrollment_id: string; arrangement: string; standard_centavos: number; special_centavos: number;
  amount_centavos: number; agency_id: string | null; reason: string | null; off_list: boolean; approval_status: SpecialStatus;
  decision_remarks: string | null; created_at: string; decided_at: string | null; requested_by_name?: string | null; decided_by_name?: string | null;
};

export const SPECIAL_PREFIX = "Special Arrangement";
/** The charge line the balance and documents show. */
export const specialDescription = (arrangement: string, course: string, agency?: string | null) => [SPECIAL_PREFIX, arrangement, course, agency].filter(Boolean).join(" · ");
export const isSpecialCharge = (c: { description?: string | null }) => (c.description ?? "").startsWith(`${SPECIAL_PREFIX} ·`);
/** NWM-SA-2026-0001 from next_reference("SA"). */
export const specialNumber = (ref: string) => `NWM-${ref.replace(/-0*(\d+)$/, (_, n: string) => `-${n.padStart(4, "0")}`)}`;

/** Why a request cannot be sent, or null. A price not on the list needs a reason. */
export function specialProblem(r: { standard: number; special: number; offList: boolean; reason?: string | null; openRequest: boolean }) {
  if (r.openRequest) return "This enrollment already has a Special Arrangement waiting for approval.";
  if (!Number.isInteger(r.special) || r.special <= r.standard) return "The special price must be higher than the standard course fee.";
  if (r.offList && (r.reason ?? "").trim().length < 5) return "Give the reason for a price that is not on the list.";
  return null;
}

/** Report totals: counts by status, the amount approved requests added, and off-list requests. */
export function specialTotals(rows: Pick<SpecialRequest, "approval_status" | "amount_centavos" | "off_list">[]) {
  const by = (s: SpecialStatus) => rows.filter((r) => r.approval_status === s);
  return { pending: by("Pending").length, approved: by("Approved").length, rejected: by("Rejected").length, added: by("Approved").reduce((s, r) => s + Number(r.amount_centavos), 0), offList: rows.filter((r) => r.off_list).length };
}

/** 8:00 PM report lines: requests waiting over a day, and off-list prices approved today (Manila). */
export function specialAlerts(rows: Pick<SpecialRequest, "request_no" | "approval_status" | "off_list" | "created_at" | "decided_at" | "special_centavos" | "arrangement">[], now = new Date()) {
  const manila = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(d);
  const today = manila(now), dayAgo = now.getTime() - 24 * 3600 * 1000;
  const peso = (c: number) => `₱${(c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
  const waiting = rows.filter((r) => r.approval_status === "Pending" && new Date(r.created_at).getTime() < dayAgo);
  const offToday = rows.filter((r) => r.approval_status === "Approved" && r.off_list && r.decided_at && manila(new Date(r.decided_at)) === today);
  return [
    ...(waiting.length ? [`${waiting.length} Special Arrangement request${waiting.length === 1 ? "" : "s"} waiting over a day: ${waiting.map((r) => r.request_no ?? r.arrangement).join(", ")}`] : []),
    ...offToday.map((r) => `Off-list Special Arrangement approved today: ${r.request_no ?? ""} ${r.arrangement} at ${peso(Number(r.special_centavos))}`.replace(/\s+/g, " ")),
  ];
}
