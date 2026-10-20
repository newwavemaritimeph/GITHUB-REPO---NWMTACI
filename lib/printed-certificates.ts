/**
 * Releasing Officer › Reports › Printed Certificates (owner, 20 Oct 2026;
 * design/certificate-report-prototype.html): every certificate printed in the
 * period with its numbers, Document No. (hologram sticker), payment and release.
 */
export type PrintedCert = { id: string; printedOn: string; printedAt: string; printedBy: string; name: string; number: string; course: string; courseName: string; regNo: string; certNo: string; docNo: string; copy: number; balance: number | null; status: "Released" | "Waiting" | "Void" | "Revoked"; releasedOn: string | null; method: string; ageDays: number };

export const PRINTED_FILTERS = {
  "All": () => true,
  "Waiting for Release": (r: PrintedCert) => r.status === "Waiting",
  "Released": (r: PrintedCert) => r.status === "Released",
  "Reprints": (r: PrintedCert) => r.copy > 1,
  "No Document No.": (r: PrintedCert) => !r.docNo && r.status !== "Revoked",
  "With Balance": (r: PrintedCert) => (r.balance ?? 0) > 0,
} as const;
export type PrintedFilter = keyof typeof PRINTED_FILTERS;

type CertIn = { id: string; status: string; printed_at?: string | null; print_count?: number | null; certificate_number?: string | null; registration_number?: string | null; sticker_no?: string | null; void_status?: string | null; revoked_at?: string | null; release_method?: string | null; printer?: unknown; snapshot?: Record<string, unknown> | null };
type Who = { name: string; number: string; course: string; courseName: string; balance: number | null };

const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const manilaDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(iso));

export function printedReportRows(certs: CertIn[], who: (certId: string) => Who | null, released: Map<string, string>, from: string, to: string, today: string): PrintedCert[] {
  return certs.filter((c) => c.printed_at && c.status !== "Cancelled").map((c) => {
    const w = who(c.id), printedOn = manilaDay(c.printed_at!), releasedOn = released.get(c.id) ?? null;
    const status: PrintedCert["status"] = c.revoked_at ? "Revoked" : c.void_status === "Requested" ? "Void" : releasedOn || c.status === "Released" ? "Released" : "Waiting";
    return { id: c.id, printedOn, printedAt: c.printed_at!, printedBy: (one(c.printer as { complete_name?: string } | null)?.complete_name) ?? "", name: w?.name ?? "Trainee", number: w?.number ?? "", course: w?.course ?? "", courseName: w?.courseName ?? "",
      regNo: c.registration_number ?? "", certNo: c.certificate_number ?? (c.snapshot?.certificate_number as string | undefined) ?? "", docNo: c.sticker_no ?? "", copy: Math.max(1, Number(c.print_count ?? 1)), balance: w?.balance ?? null,
      status, releasedOn, method: c.release_method ?? "Pickup", ageDays: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${printedOn}T00:00:00Z`)) / 864e5) };
  }).filter((r) => r.printedOn >= from && r.printedOn <= to).sort((a, b) => b.printedAt.localeCompare(a.printedAt));
}
