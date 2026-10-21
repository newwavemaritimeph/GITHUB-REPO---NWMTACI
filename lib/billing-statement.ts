import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Billing Statement (owner, 22 Oct 2026): every enrollment referred by an agency or
 * consultancy, by date enrolled within the coverage, at the full training fee (the
 * referral rebate is not taken off), with the training status.
 */
export type BillingRow = { enrolled: string; name: string; training: string; status: string; amount: number };
export type BillingStatement = { bsNumber: string; date: string; billTo: string; kind: string; coverage: string; rows: BillingRow[]; total: number };

export const bsNumber = (n: number) => String(n).padStart(6, "0");

/** Completed, Ongoing, Scheduled or No Schedule, from the training dates and today (YYYY-MM-DD). */
export function trainingStatus(startsOn: string | null, endsOn: string | null, today: string) {
  if (!startsOn) return "No Schedule";
  if ((endsOn ?? startsOn) < today) return "Completed";
  return startsOn <= today ? "Ongoing" : "Scheduled";
}

const long = (d: string) => new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const short = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
export const coverageLabel = (from: string, to: string) => `${short(from)} - ${short(to)}, ${to.slice(0, 4)} (as per date enrolled)`;
export const longDate = long;

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const manilaDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(iso));
const chunks = <T,>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Partners that referred anyone enrolled in the coverage, with their rows (one statement each). */
export async function buildBillingRows(db: Admin, from: string, to: string) {
  const today = manilaDay(new Date().toISOString());
  type Enr = { id: string; created_at: string; enrolled_at?: string | null; selling_price_centavos: number; scheduled_on: string | null; referral_agency_id: string | null;
    courses: { code: string } | { code: string }[] | null; batches: { starts_on: string; ends_on: string } | { starts_on: string; ends_on: string }[] | null;
    trainees: { legal_first_name: string; legal_last_name: string; marketing_agency_id: string | null } | { legal_first_name: string; legal_last_name: string; marketing_agency_id: string | null }[] | null };
  const rows: Enr[] = [];
  for (let a = 0; a < 20000; a += 1000) {
    const { data, error } = await db.from("enrollments").select("id,created_at,selling_price_centavos,scheduled_on,referral_agency_id,courses(code),batches(starts_on,ends_on),trainees(legal_first_name,legal_last_name,marketing_agency_id)")
      .neq("enrollment_status", "Cancelled").gte("created_at", `${from}T00:00:00+08:00`).lte("created_at", `${to}T23:59:59.999+08:00`).order("created_at").range(a, a + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as Enr[]));
    if ((data ?? []).length < 1000) break;
  }
  const agencyOf = (e: Enr) => e.referral_agency_id ?? one(e.trainees)?.marketing_agency_id ?? null;
  const referred = rows.filter((e) => agencyOf(e));
  // The full fee keeps charges and other discounts (e.g. the CCI Package discount); only the referral rebate is left out.
  const extra = new Map<string, number>();
  for (const part of chunks(referred.map((e) => e.id))) {
    const { data } = await db.from("enrollment_charges").select("enrollment_id,amount_centavos,event_type,description").in("enrollment_id", part).eq("valid", true);
    for (const c of (data ?? []) as { enrollment_id: string; amount_centavos: number; event_type: string; description: string }[]) {
      if (c.event_type === "discount" && /^referral rebate/i.test(c.description)) continue;
      extra.set(c.enrollment_id, (extra.get(c.enrollment_id) ?? 0) + (c.event_type === "discount" ? -1 : 1) * Number(c.amount_centavos));
    }
  }
  const byAgency = new Map<string, BillingRow[]>();
  for (const e of referred) {
    const t = one(e.trainees), b = one(e.batches);
    const row: BillingRow = { enrolled: long(manilaDay(e.created_at)), name: `${(t?.legal_last_name ?? "").toUpperCase()}, ${(t?.legal_first_name ?? "").toUpperCase()}`, training: one(e.courses)?.code ?? "", status: trainingStatus(b?.starts_on ?? e.scheduled_on, b?.ends_on ?? e.scheduled_on, today), amount: Number(e.selling_price_centavos ?? 0) + (extra.get(e.id) ?? 0) };
    const id = agencyOf(e) as string;
    byAgency.set(id, [...(byAgency.get(id) ?? []), row]);
  }
  const ids = [...byAgency.keys()];
  const { data: agencies } = ids.length ? await db.from("marketing_agencies").select("*").in("id", ids) : { data: [] };
  return ((agencies ?? []) as { id: string; name: string; kind?: string | null }[]).map((a) => ({ agencyId: a.id, billTo: a.name, kind: a.kind ?? "Agency", rows: byAgency.get(a.id) ?? [] }))
    .sort((x, y) => x.billTo.localeCompare(y.billTo));
}

export const statementTotal = (rows: BillingRow[]) => rows.reduce((t, r) => t + r.amount, 0);
