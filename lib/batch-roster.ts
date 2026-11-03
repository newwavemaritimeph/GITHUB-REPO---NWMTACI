import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Batch trainee list (owner, 3 Nov 2026): every non-cancelled trainee on one batch, read straight from the
 * database (the portal's own list holds only the newest enrollments), for the Batch window, Excel and PDF.
 */
export type RosterRow = {
  enrollmentId: string; name: string; nwmtaciNo: string; srn: string; rank: string; mobile: string; email: string;
  source: string; status: string; payment: "Paid" | "Balance" | "Company Charge" | "Not Paid Yet"; balanceCentavos: number; requirements: number;
};
export type BatchRoster = {
  batch: { id: string; batchNumber: string; code: string; course: string; startsOn: string; endsOn: string; dailyStart: string | null; dailyEnd: string | null; room: string | null; instructor: string | null; capacity: number; held: number };
  rows: RosterRow[];
};

/** Payment state of one enrollment: Company Charge is billed to the partner, never "unpaid". */
export function paymentState(due: number, paid: number, companyCharge: boolean): { payment: RosterRow["payment"]; balanceCentavos: number } {
  const balance = Math.max(0, due - paid);
  if (companyCharge) return { payment: "Company Charge", balanceCentavos: balance };
  if (balance === 0 && due > 0) return { payment: "Paid", balanceCentavos: 0 };
  return { payment: paid > 0 ? "Balance" : "Not Paid Yet", balanceCentavos: balance };
}

/** Enrolled first, then Pending; by name inside each. */
export const sortRoster = (rows: RosterRow[]) => [...rows].sort((a, z) => (a.status === z.status ? 0 : a.status === "Pending" ? 1 : z.status === "Pending" ? -1 : 0) || a.name.localeCompare(z.name));

const REQUIRED = ["valid_id", "medical_peme", "photo_2x2", "seamans_book"];
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const sourceLabel = (source: string | null, partner: { name: string; kind?: string | null } | null) =>
  partner ? `${partner.kind === "Consultancy" ? "Consultancy" : "Agency"} · ${partner.name}` : source === "Walk-in" ? "Walk-In" : source === "Meta" ? "Meta" : "Online";

export async function loadBatchRoster(db: ReturnType<typeof createSupabaseAdminClient>, batchId: string): Promise<BatchRoster | null> {
  const { data: b } = await db.from("batches").select("id,batch_number,starts_on,ends_on,daily_start,daily_end,venue,capacity,confirmed_count,courses(code,name)").eq("id", batchId).maybeSingle();
  if (!b) return null;
  const [{ data: ens }, { data: res }] = await Promise.all([
    db.from("enrollments").select("id,enrollment_status,source,selling_price_centavos,referral_agency_id,trainee_id,trainees(legal_first_name,legal_middle_name,legal_last_name,suffix,application_number,trainee_number,srn,rank,mobile,email,marketing_agency_id)").eq("batch_id", batchId).neq("enrollment_status", "Cancelled"),
    db.from("batch_resources").select("classrooms(name),instructors!batch_resources_instructor_id_fkey(complete_name)").eq("batch_id", batchId).maybeSingle(),
  ]);
  const list = (ens ?? []) as unknown as { id: string; enrollment_status: string; source: string | null; selling_price_centavos: number; referral_agency_id: string | null; trainees: unknown }[];
  const ids = list.map((e) => e.id);
  const [{ data: allocs }, { data: charges }, { data: checks }, cc] = ids.length ? await Promise.all([
    db.from("payment_allocations").select("enrollment_id,amount_centavos,payments!inner(valid)").in("enrollment_id", ids).eq("payments.valid", true),
    db.from("enrollment_charges").select("enrollment_id,amount_centavos,event_type").in("enrollment_id", ids).eq("valid", true),
    db.from("enrollment_requirement_checks").select("enrollment_id,requirement,status,checked_at").in("enrollment_id", ids).order("checked_at", { ascending: false }),
    db.from("enrollments").select("id").in("id", ids).not("company_charge_agency_id", "is", null),
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  type T = { legal_first_name: string; legal_middle_name: string | null; legal_last_name: string; suffix: string | null; application_number: string | null; trainee_number: string; srn: string | null; rank: string | null; mobile: string | null; email: string | null; marketing_agency_id: string | null };
  const agencyIds = [...new Set(list.map((e) => e.referral_agency_id ?? one(e.trainees as T | null)?.marketing_agency_id).filter(Boolean) as string[])];
  const { data: ags } = agencyIds.length ? await db.from("marketing_agencies").select("id,name,kind").in("id", agencyIds) : { data: [] };
  const agency = new Map((ags ?? []).map((a) => [a.id as string, a as { name: string; kind: string | null }]));
  const billed = new Set(((cc as { data: { id: string }[] | null }).data ?? []).map((x) => x.id));
  const paid = new Map<string, number>(), due = new Map<string, number>(list.map((e) => [e.id, Number(e.selling_price_centavos ?? 0)]));
  for (const a of (allocs ?? []) as { enrollment_id: string; amount_centavos: number }[]) paid.set(a.enrollment_id, (paid.get(a.enrollment_id) ?? 0) + Number(a.amount_centavos));
  for (const c of (charges ?? []) as { enrollment_id: string; amount_centavos: number; event_type: string }[]) due.set(c.enrollment_id, (due.get(c.enrollment_id) ?? 0) + (c.event_type === "discount" ? -1 : 1) * Number(c.amount_centavos));
  const latest = new Map<string, string>();
  for (const c of (checks ?? []) as { enrollment_id: string; requirement: string; status: string }[]) { const k = `${c.enrollment_id}|${c.requirement === "medical_certificate" ? "medical_peme" : c.requirement}`; if (!latest.has(k)) latest.set(k, c.status); }
  const rows = list.map((e): RosterRow => {
    const t = one(e.trainees as T | null);
    const partner = agency.get(e.referral_agency_id ?? t?.marketing_agency_id ?? "") ?? null;
    const p = paymentState(due.get(e.id) ?? 0, paid.get(e.id) ?? 0, billed.has(e.id));
    return { enrollmentId: e.id, name: t ? `${t.legal_last_name.toUpperCase()}, ${t.legal_first_name}${t.legal_middle_name ? ` ${t.legal_middle_name.charAt(0)}.` : ""}${t.suffix ? ` ${t.suffix}` : ""}` : "—",
      nwmtaciNo: t?.application_number ?? t?.trainee_number ?? "", srn: t?.srn ?? "", rank: t?.rank ?? "", mobile: t?.mobile ?? "", email: t?.email ?? "",
      source: sourceLabel(e.source, partner), status: e.enrollment_status, ...p, requirements: REQUIRED.filter((r) => latest.get(`${e.id}|${r}`) === "Verified").length };
  });
  const course = one(b.courses as unknown as { code: string; name: string } | null);
  const r = res as unknown as { classrooms?: unknown; instructors?: unknown } | null;
  return {
    batch: { id: b.id as string, batchNumber: b.batch_number as string, code: course?.code ?? "", course: course?.name ?? "", startsOn: b.starts_on as string, endsOn: b.ends_on as string, dailyStart: (b.daily_start as string | null) ?? null, dailyEnd: (b.daily_end as string | null) ?? null,
      room: one(r?.classrooms as { name: string } | null)?.name ?? (b.venue as string | null) ?? null, instructor: one(r?.instructors as { complete_name: string } | null)?.complete_name ?? null, capacity: Number(b.capacity ?? 24), held: Number(b.confirmed_count ?? 0) },
    rows: sortRoster(rows),
  };
}
