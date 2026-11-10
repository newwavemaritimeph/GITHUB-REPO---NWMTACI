import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/security";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canHr, hrPdf, latestTemplate, manilaToday } from "@/lib/hr-server";
import { fillTemplate, longDate, type HrDocSnapshot } from "@/lib/print/hr-documents";

export const runtime = "nodejs";

/**
 * HR documents on the letterhead (owner, 10 Nov 2026). Forms "coe" (A4), "nte" and "memo" (Legal):
 *   ?type=coe&id=…   an issued Certificate of Employment: HR, the Admin, or the employee it is for;
 *   ?type=memo&id=…  an issued memo: HR, the Admin, or a recipient;
 *   ?type=preview&doc=coe|nte|memo  the newest template with sample details: HR and the Admin.
 * Issued documents print from their saved snapshot.
 */
const SAMPLE: Record<"coe" | "nte" | "memo", Record<string, string>> = {
  coe: { employee_name: "MARIA L. SAMPLE", title: "Ms.", last_name: "Sample", position: "Registration Officer", date_hired: "March 3, 2024", date_until: "the present", employment_type: "regular", purpose: "a personal loan application", date_issued: "10th day of November 2026" },
  nte: { incident_facts: "On November 6, 2026, at about 2:30 PM, … (the specific acts, with date, time and place).", rule_violated: "Code of Conduct, Section …", possible_sanction: "…", response_due: "November 15, 2026" },
  memo: { memo_body: "Please be informed that … (the memo text)." },
};

export async function GET(request: Request) {
  const staff = await requireStaff();
  if (!staff) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const url = new URL(request.url), type = url.searchParams.get("type");
  const db = createSupabaseAdminClient();
  const isHr = canHr(staff.roleCodes);
  const self = async () => (await db.from("employees").select("id").ilike("work_email", staff.user.email ?? "___none___").maybeSingle()).data?.id as string | undefined;
  let doc: HrDocSnapshot | null = null;

  if (type === "preview") {
    if (!isHr) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    const kind = z.enum(["coe", "nte", "memo"]).safeParse(url.searchParams.get("doc"));
    if (!kind.success) return NextResponse.json({ error: "Choose the COE, NTE or memo." }, { status: 400 });
    const t = await latestTemplate(db, kind.data);
    if (!t) return NextResponse.json({ error: "Apply database update 202611100096 first." }, { status: 400 });
    const rows: [string, string][] | undefined = kind.data === "coe" ? undefined : kind.data === "nte"
      ? [["To", "SAMPLE, Juan P. · Registration Officer"], ["From", "Admin, New Wave Maritime"], ["Date", longDate(manilaToday())], ["Subject", "Notice to Explain"]]
      : [["To", "All Employees"], ["From", "Admin, New Wave Maritime"], ["Date", longDate(manilaToday())], ["Subject", "Sample Memo"], ["Type", "General Announcement"]];
    doc = { type: kind.data, number: kind.data === "coe" ? "NWM-COE-2026-0000" : kind.data === "nte" ? "NWM-NTE-2026-000" : "NWM-MEMO-2026-000", templateVersion: t.version, body: fillTemplate(t.body, SAMPLE[kind.data]), signatories: t.signatories, rows, sample: true };
  } else if (type === "coe" || type === "memo") {
    const id = z.string().uuid().safeParse(url.searchParams.get("id"));
    if (!id.success) return NextResponse.json({ error: "Choose a document." }, { status: 400 });
    if (type === "coe") {
      const { data } = await db.from("coe_requests").select("employee_id,snapshot").eq("id", id.data).maybeSingle();
      if (!data?.snapshot) return NextResponse.json({ error: "This certificate has not been issued yet." }, { status: 404 });
      if (!isHr && data.employee_id !== (await self())) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
      doc = data.snapshot as HrDocSnapshot;
    } else {
      const { data } = await db.from("memos").select("id,snapshot").eq("id", id.data).maybeSingle();
      if (!data?.snapshot) return NextResponse.json({ error: "No printable copy of this memo." }, { status: 404 });
      if (!isHr) {
        const me = await self();
        const { data: rec } = me ? await db.from("memo_recipients").select("memo_id").eq("memo_id", id.data).eq("employee_id", me).maybeSingle() : { data: null };
        if (!rec) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
      }
      doc = data.snapshot as HrDocSnapshot;
    }
  } else return NextResponse.json({ error: "Choose a document." }, { status: 400 });

  const bytes = await hrPdf(db, doc);
  return new NextResponse(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${doc.number}.pdf"`, "cache-control": "private, no-store" } });
}
