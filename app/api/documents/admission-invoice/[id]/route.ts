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
  const db = createSupabaseAdminClient();
  const { data } = await db.from("enrollments")
    .select("id,enrollment_number,registration_reference,selling_price_centavos,enrollment_status,trainees(trainee_number,legal_first_name,legal_middle_name,legal_last_name,suffix,email,mobile,srn),courses(name,code),batches(batch_number,starts_on,ends_on,daily_start,daily_end,venue)")
    .eq("id", id).maybeSingle();
  if (!data) return NextResponse.json({ error: "Enrollment not found." }, { status: 404 });
  const trainee = one(data.trainees), course = one(data.courses), batch = one(data.batches);
  if (!trainee) return NextResponse.json({ error: "Trainee record is incomplete." }, { status: 409 });

  const { data: allocations } = await db.from("payment_allocations")
    .select("amount_centavos,payments!inner(payment_number,method,reference_number,received_at,valid)")
    .eq("enrollment_id", id).eq("payments.valid", true);
  const { data: chargeRows } = await db.from("enrollment_charges")
    .select("description,amount_centavos,event_type").eq("enrollment_id", id).eq("valid", true).order("created_at");
  const paid = (allocations ?? []).reduce((sum, a) => sum + Number(a.amount_centavos), 0);
  const chargeTotal = (chargeRows ?? []).filter((r) => r.event_type !== "discount").reduce((sum, r) => sum + Number(r.amount_centavos), 0);
  const discountTotal = (chargeRows ?? []).filter((r) => r.event_type === "discount").reduce((sum, r) => sum + Number(r.amount_centavos), 0);
  const due = Number(data.selling_price_centavos) + chargeTotal - discountTotal;
  const balance = Math.max(0, due - paid);
  const paymentStatus = balance <= 0 && paid > 0 ? "Paid" : paid > 0 ? "Partially Paid" : "Unpaid";

  const lines: AdmissionInvoiceLine[] = [
    { description: `${course?.name ?? "Training"} fee`, detail: data.enrollment_number, amountCentavos: Number(data.selling_price_centavos) },
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
    course: `${course?.name ?? "Training"}${course?.code ? ` (${course.code})` : ""}`,
    schedule: batch ? `${fmtDate(batch.starts_on)} – ${fmtDate(batch.ends_on)}` : "Open schedule",
    time: batch?.daily_start ? `${batch.daily_start.slice(0, 5)} – ${batch.daily_end?.slice(0, 5) ?? ""}` : "8:00 AM – 5:00 PM",
    venue: batch?.venue ?? "",
    instructor: "",
    registrationStatus: data.enrollment_status,
    issuedAt: new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" }).format(new Date()),
    officer: "",
    cashier: "",
    lines,
    dueCentavos: due,
    paidCentavos: paid,
    balanceCentavos: balance,
    paymentStatus,
    logoBytes,
  });
  return new Response(bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${data.enrollment_number}-admission-invoice.pdf"`, "cache-control": "private, no-store" } });
}
