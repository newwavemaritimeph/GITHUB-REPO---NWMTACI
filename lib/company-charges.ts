import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { periodStart, periodTitle, type Period } from "@/lib/accounting-periods";
import { referralRebate, rebateFor } from "@/lib/referral";
import type { ChargeRow, CompanyStatement } from "@/lib/print/company-charges";

/**
 * Company Charge List (owner, 22 Oct 2026): every trainee referred by an agency or
 * consultancy whose training falls in the period, at the full fee (the referral
 * rebate is not taken off), with the rebate and its status shown apart.
 */
/** Paid, Partly Paid or Unpaid, against the fee less a rebate already deducted. */
export const payStatus = (r: { fee: number; paid: number; rebate: number; rebateStatus: string }) => {
  const owed = r.fee - (r.rebateStatus === "Deducted" ? r.rebate : 0);
  return r.paid >= owed ? "Paid" : r.paid > 0 ? "Partly Paid" : "Unpaid";
};

export const RULE_LABEL: Record<string, string> = { Deducted: "Deducted on Any Payment", "Deducted on full payment": "Deducted Once Fully Paid", "No deduction": "Paid to the Partner Later" };

/** The rebate status from the agency_rebates row (if any) and the rebate configured for the course. */
export function rebateStatus(record: { status: string; settlement?: string | null } | null, configured: number) {
  if (record) {
    if (record.status === "Pending") return "Owed to the Partner";
    if (record.status === "Paid") return /^deducted/i.test(record.settlement ?? "Deducted") ? "Deducted" : "Paid to the Partner";
    return "None";
  }
  return configured > 0 ? "Not Deducted Yet" : "None";
}

/** One statement per company, companies by name, trainees by training date then name. */
export function groupStatements(rows: (ChargeRow & { agencyId: string; startsOn: string })[], agencies: Map<string, { name: string; kind: string; rule: string }>, periodLabel: string, printedOn: string, monthKey: string) {
  const by = new Map<string, (ChargeRow & { startsOn: string })[]>();
  for (const r of rows) by.set(r.agencyId, [...(by.get(r.agencyId) ?? []), r]);
  return [...by.entries()].map(([id, list]) => ({ id, a: agencies.get(id) ?? { name: "Partner", kind: "Agency", rule: "" }, list }))
    .sort((x, y) => x.a.name.localeCompare(y.a.name))
    .map(({ id, a, list }, i): CompanyStatement & { agencyId: string } => ({
      agencyId: id, statementNo: `CCL-${monthKey}-${String(i + 1).padStart(3, "0")}`, company: a.name, kind: a.kind, rule: a.rule, periodLabel, printedOn,
      rows: list.sort((x, y) => x.startsOn.localeCompare(y.startsOn) || x.name.localeCompare(y.name)).map((r): ChargeRow => ({ name: r.name, number: r.number, course: r.course, training: r.training, fee: r.fee, paid: r.paid, rebate: r.rebate, rebateStatus: r.rebateStatus })),
    }));
}

type Admin = ReturnType<typeof createSupabaseAdminClient>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const chunks = <T,>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const day = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const long = (d: string) => new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export type CompanyCharges = Awaited<ReturnType<typeof buildCompanyCharges>>;

export async function buildCompanyCharges(db: Admin, period: Period, end: string) {
  const from = periodStart(period, end), to = end;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const batches: { id: string; starts_on: string; ends_on: string }[] = [];
  for (let a = 0; a < 20000; a += 1000) {
    const { data } = await db.from("batches").select("id,starts_on,ends_on").gte("starts_on", from).lte("starts_on", to).range(a, a + 999);
    batches.push(...((data ?? []) as typeof batches));
    if ((data ?? []).length < 1000) break;
  }
  const batchById = new Map(batches.map((b) => [b.id, b]));
  type Enr = { id: string; course_id: string; batch_id: string | null; scheduled_on: string | null; selling_price_centavos: number; enrollment_status: string; partner_offer_id: string | null; referral_agency_id: string | null; courses: { code: string; name: string; delivery_type: string } | { code: string; name: string; delivery_type: string }[] | null; trainees: { legal_first_name: string; legal_last_name: string; trainee_number: string; application_number?: string | null; marketing_agency_id: string | null } | { legal_first_name: string; legal_last_name: string; trainee_number: string; application_number?: string | null; marketing_agency_id: string | null }[] | null };
  const cols = "id,course_id,batch_id,scheduled_on,selling_price_centavos,enrollment_status,partner_offer_id,referral_agency_id,courses(code,name,delivery_type),trainees(legal_first_name,legal_last_name,trainee_number,application_number,marketing_agency_id)";
  const enrolled: Enr[] = [];
  for (const ids of chunks(batches.map((b) => b.id))) { const { data } = await db.from("enrollments").select(cols).in("batch_id", ids).neq("enrollment_status", "Cancelled"); enrolled.push(...((data ?? []) as unknown as Enr[])); }
  { const { data } = await db.from("enrollments").select(cols).is("batch_id", null).gte("scheduled_on", from).lte("scheduled_on", to).neq("enrollment_status", "Cancelled").limit(5000); enrolled.push(...((data ?? []) as unknown as Enr[])); }
  const agencyOf = (e: Enr) => e.referral_agency_id ?? one(e.trainees)?.marketing_agency_id ?? null;
  const referred = enrolled.filter((e) => agencyOf(e));
  const ids = referred.map((e) => e.id);
  const agencyIds = [...new Set(referred.map((e) => agencyOf(e) as string))];
  const [{ data: agencies }, { data: matrix }] = await Promise.all([
    agencyIds.length ? db.from("marketing_agencies").select("*").in("id", agencyIds) : Promise.resolve({ data: [] as unknown[] }),
    agencyIds.length ? db.from("agency_course_rebates").select("agency_id,course_id,rebate_centavos").in("agency_id", agencyIds) : Promise.resolve({ data: [] as unknown[] }),
  ]);
  const agencyById = new Map(((agencies ?? []) as { id: string; name: string; kind?: string | null; rebate_mode?: string | null; rebate_percent?: number | null }[]).map((a) => [a.id, a]));
  const records = new Map<string, { status: string; settlement?: string | null; rebate_centavos: number }>();
  const extra = new Map<string, number>(), paid = new Map<string, number>();
  for (const part of chunks(ids)) {
    const [rb, ch, al] = await Promise.all([
      db.from("agency_rebates").select("*").in("enrollment_id", part),
      db.from("enrollment_charges").select("enrollment_id,amount_centavos,event_type,description").in("enrollment_id", part).eq("valid", true),
      db.from("payment_allocations").select("enrollment_id,amount_centavos,payments!inner(valid)").in("enrollment_id", part).eq("payments.valid", true),
    ]);
    for (const r of (rb.data ?? []) as { enrollment_id: string; status: string; settlement?: string | null; rebate_centavos: number }[]) records.set(r.enrollment_id, r);
    // The full fee keeps charges and other discounts (e.g. the CCI Package discount); only the referral rebate is left out.
    for (const c of (ch.data ?? []) as { enrollment_id: string; amount_centavos: number; event_type: string; description: string }[]) { if (c.event_type === "discount" && /^referral rebate/i.test(c.description)) continue; extra.set(c.enrollment_id, (extra.get(c.enrollment_id) ?? 0) + (c.event_type === "discount" ? -1 : 1) * Number(c.amount_centavos)); }
    for (const a of (al.data ?? []) as { enrollment_id: string; amount_centavos: number }[]) paid.set(a.enrollment_id, (paid.get(a.enrollment_id) ?? 0) + Number(a.amount_centavos));
  }
  const rows = referred.map((e) => {
    const agencyId = agencyOf(e) as string, a = agencyById.get(agencyId), c = one(e.courses), t = one(e.trainees), b = e.batch_id ? batchById.get(e.batch_id) : null;
    const startsOn = b?.starts_on ?? e.scheduled_on ?? from, endsOn = b?.ends_on ?? startsOn;
    const configured = referralRebate({ percent: Number(a?.rebate_percent ?? 0) || null, inHouse: c?.delivery_type === "In-House", courseCode: c?.code ?? null, feeCentavos: Number(e.selling_price_centavos ?? 0), matrixCentavos: rebateFor(agencyId, e.course_id, (matrix ?? []) as { agency_id: string; course_id: string; rebate_centavos: number }[]) });
    const rec = records.get(e.id) ?? null;
    return { agencyId, startsOn, name: `${(t?.legal_last_name ?? "").toUpperCase()}, ${t?.legal_first_name ?? ""}`, number: t?.application_number ?? t?.trainee_number ?? "", course: c?.code ?? "", training: startsOn === endsOn ? day(startsOn) : `${day(startsOn)} - ${day(endsOn)}`,
      fee: Number(e.selling_price_centavos ?? 0) + (extra.get(e.id) ?? 0), paid: paid.get(e.id) ?? 0, rebate: rec ? Number(rec.rebate_centavos) : configured, rebateStatus: rebateStatus(rec, configured) };
  });
  const info = new Map([...agencyById.values()].map((a) => [a.id, { name: a.name, kind: a.kind ?? "Agency", rule: RULE_LABEL[a.rebate_mode ?? "Deducted"] ?? "Deducted on Any Payment" }]));
  const statements = groupStatements(rows, info, `${long(from)} - ${long(to)}`, long(today), to.slice(0, 7));
  return { period, from, to, title: periodTitle(period, end), statements };
}
