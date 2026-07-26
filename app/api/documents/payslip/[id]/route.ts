import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createPayslipPdf } from "@/lib/documents";

export const runtime = "nodejs";
const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

/** Employee payslip (half-sheet) generated from a finalized payroll item. HR/Admin only. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  if (!staff || !staff.roleCodes.some((role) => ["admin", "hr"].includes(role))) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const { id } = await params;
  const db = createSupabaseAdminClient();
  const { data: item } = await db.from("payroll_items")
    .select("gross_centavos,deduction_centavos,net_centavos,breakdown,employees(employee_number,complete_name,position,pay_type,date_hired),payroll_periods(period_number,starts_on,ends_on,pay_date)")
    .eq("id", id).maybeSingle();
  if (!item) return NextResponse.json({ error: "Payroll item not found." }, { status: 404 });
  const employee = one(item.employees), period = one(item.payroll_periods);
  if (!employee || !period) return NextResponse.json({ error: "Payroll record is incomplete." }, { status: 409 });

  const breakdown = (item.breakdown ?? {}) as { basic_centavos?: number; present_days?: number; advance_deducted_centavos?: number };
  const earnings = [{ label: `Basic pay${breakdown.present_days ? ` (${breakdown.present_days} days)` : ""}`, amountCentavos: Number(breakdown.basic_centavos ?? item.gross_centavos) }];
  const deductions = Number(item.deduction_centavos) > 0 ? [{ label: "Cash advance", amountCentavos: Number(item.deduction_centavos) }] : [];

  let logoBytes: Uint8Array | undefined;
  try { logoBytes = new Uint8Array(await (await fetch(new URL("/new-wave-emblem.png", request.url))).arrayBuffer()); } catch { logoBytes = undefined; }

  const bytes = await createPayslipPdf({
    employeeNumber: employee.employee_number,
    employeeName: employee.complete_name,
    position: employee.position,
    payFrequency: employee.pay_type,
    dateHired: employee.date_hired,
    period: `${period.period_number} (${period.starts_on} – ${period.ends_on})`,
    payDate: period.pay_date,
    earnings,
    deductions,
    grossCentavos: Number(item.gross_centavos),
    totalDeductionsCentavos: Number(item.deduction_centavos),
    netCentavos: Number(item.net_centavos),
    preparedBy: staff.user.email?.split("@")[0] ?? "HR",
    logoBytes,
  });
  return new Response(bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="payslip-${employee.employee_number}-${period.pay_date}.pdf"`, "cache-control": "private, no-store" } });
}
