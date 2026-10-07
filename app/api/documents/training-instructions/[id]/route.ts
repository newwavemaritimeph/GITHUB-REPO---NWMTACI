import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildTrainingInstructionsPdf, loadInstructionDetails } from "@/lib/training-instructions";

export const runtime = "nodejs";

/** Per-enrollment training instructions (half A4), the same PDF that is emailed to the trainee. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const { id } = await params;
  const details = await loadInstructionDetails(createSupabaseAdminClient(), id);
  if (!details) return NextResponse.json({ error: "Enrollment not found." }, { status: 404 });
  if (!["Enrolled", "Open Schedule"].includes(details.enrollmentStatus)) return NextResponse.json({ error: "Instructions are available once the trainee is paid and enrolled." }, { status: 400 });
  const bytes = await buildTrainingInstructionsPdf(details, new URL(request.url).origin);
  return new Response(bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="training-instructions-${details.enrollmentNumber}.pdf"`, "cache-control": "private, no-store" } });
}
