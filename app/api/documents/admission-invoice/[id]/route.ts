import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createAdmissionInvoicePdf, type AdmissionInvoiceLine } from "@/lib/documents";

export const runtime = "nodejs";
const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const fmtDate = (value?: string | null) => (value ? new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(`${value}T00:00:00+08:00`)) : "—");

/** Combined Admission Slip + Payment Invoice on one 8×13 long-bond sheet
 * (ORIGINAL top / DUPLICATE bottom), generated from live Supabase records. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const { id } = await params;
  const url = new URL(request.url);
  const officerName = (url.searchParams.get("officer") ?? "").slice(0, 120);
  const cashierName = (url.searchParams.get("cashier") ?? "").slice(0, 120);
  const db = createSupabaseAdminClient();
  const selectCols = "id,enrollment_number,selling_price_centavos,enrollment_status,created_at,trainee_id,trainees(trainee_number,legal_first_name,legal_middle_name,legal_last_name,suffix,email,mobile,srn),courses(name,code),batches(batch_number,starts_on,ends_on,daily_start,daily_end,venue)";
  const { data } = await db.from("enrollments").select(selectCols).eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Enrollment not found." }, { status: 404 });
  const trainee = one(data.trainees);
  if (!trainee) return NextResponse.json({ error: "Trainee record is incomplete." }, { status: 409 });

  // One admission record covers every course the trainee enrolled in on the
  // same day (same-day enrollments), not just the opened row.
  const day = String(data.created_at).slice(0, 10);
  const { data: siblingRows } = await db.from("enrollments").select(selectCols)
    .eq("trainee_id", data.trainee_id).gte("created_at", `${day}T00:00:00+08:00`).lte("created_at", `${day}T23:59:59+08:00`)
    .order("created_at");
  const group = (siblingRows && siblingRows.length ? siblingRows : [data]);

  const timeOf = (b: { daily_start?: string | null; daily_end?: string | null } | null) =>
    b?.daily_start ? `${b.daily_start.slice(0, 5)} – ${b.daily_end?.slice(0, 5) ?? ""}` : "8:00 AM – 5:00 PM";
  const courses = group.map((row) => {
    const course = one(row.courses), batch = one(row.batches);
    return {
      course: `${course?.name ?? "Training"}${course?.code ? ` (${course.code})` : ""}`,
      schedule: batch ? `${fmtDate(batch.starts_on)} – ${fmtDate(batch.ends_on)}` : "Open schedule",
      time: timeOf(batch),
      venue: batch?.venue ?? "",
      instructor: "",
    };
  });

  // Aggregate charges + payments across every same-day enrollment.
  const ids = group.map((row) => row.id);
  const { data: allocations } = await db.from("payment_allocations")
    .select("enrollment_id,amount_centavos,payments!inner(payment_number,method,reference_number,received_at,valid)")
    .in("enrollment_id", ids).eq("payments.valid", true);
  const { data: chargeRows } = await db.from("enrollment_charges")
    .select("enrollment_id,description,amount_centavos,event_type").in("enrollment_id", ids).eq("valid", true).order("created_at");
  const paid = (allocations ?? []).reduce((sum, a) => sum + Number(a.amount_centavos), 0);
  const chargeTotal = (chargeRows ?? []).filter((r) => r.event_type !== "discount").reduce((sum, r) => sum + Number(r.amount_centavos), 0);
  const discountTotal = (chargeRows ?? []).filter((r) => r.event_type === "discount").reduce((sum, r) => sum + Number(r.amount_centavos), 0);
  const feeTotal = group.reduce((sum, row) => sum + Number(row.selling_price_centavos), 0);
  const due = feeTotal + chargeTotal - discountTotal;
  const balance = Math.max(0, due - paid);
  const paymentStatus = balance <= 0 && paid > 0 ? "Paid" : paid > 0 ? "Partially Paid" : "Unpaid";

  const lines: AdmissionInvoiceLine[] = [
    ...group.map((row) => ({ description: `${one(row.courses)?.name ?? "Training"} fee`, detail: row.enrollment_number, amountCentavos: Number(row.selling_price_centavos) })),
    ...(chargeRows ?? []).map((r) => ({ description: r.event_type === "discount" ? `Rebate — ${r.description}` : r.description, detail: r.event_type === "discount" ? "Discount" : "Other charge", amountCentavos: Number(r.amount_centavos), negative: r.event_type === "discount" })),
    ...(allocations ?? []).map((a) => {
      const payment = one(a.payments as unknown as { payment_number: string; method: string; reference_number?: string | null; received_at: string });
      return { description: `Payment ${payment?.payment_number ?? ""}`, detail: `${payment?.method ?? ""}${payment?.reference_number ? ` · Ref ${payment.reference_number}` : ""}`, amountCentavos: Number(a.amount_centavos), negative: true };
    }),
  ];

  let logoBytes: Uint8Array | undefined;
  try { logoBytes = new Uint8Array(await (await fetch(new URL("/new-wave-emblem.png", request.url))).arrayBuffer()); } catch { logoBytes = undefined; }

  const bytes = await createAdmissionInvoicePdf({
    reference: data.enrollment_number,
    traineeName: `${trainee.legal_first_name} ${trainee.legal_middle_name ?? ""} ${trainee.legal_last_name}${trainee.suffix ? ` ${trainee.suffix}` : ""}`.replace(/\s+/g, " ").trim(),
    traineeNumber: trainee.trainee_number,
    srn: trainee.srn ?? "",
    mobile: trainee.mobile,
    email: trainee.email,
    courses,
    registrationStatus: data.enrollment_status,
    issuedAt: new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date()),
    officer: officerName,
    cashier: cashierName,
    lines,
    dueCentavos: due,
    paidCentavos: paid,
    balanceCentavos: balance,
    paymentStatus,
    logoBytes,
  });
  return new Response(bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${data.enrollment_number}-admission-invoice.pdf"`, "cache-control": "private, no-store" } });
}
