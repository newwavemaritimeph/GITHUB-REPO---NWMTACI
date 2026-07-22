import { createBrandedPdf } from "@/lib/documents";

export async function GET() {
  const bytes = await createBrandedPdf({ title: "Training Enrollment Summary", reference: "ENR-2026-000107", issuedAt: "July 23, 2026", sections: [{ heading: "Trainee and course", rows: [{ label: "Trainee", value: "Ana Mendoza" }, { label: "Course", value: "Basic Training" }, { label: "Training center", value: "Nautical Options" }] }, { heading: "Accounting snapshot", rows: [{ label: "Training fee", value: "PHP 5,500" }, { label: "Payment status", value: "Paid" }, { label: "Remaining balance", value: "PHP 0" }] }] });
  return new Response(bytes as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": "inline; filename=new-wave-enrollment.pdf" } });
}
