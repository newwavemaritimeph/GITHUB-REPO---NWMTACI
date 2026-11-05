import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Form Numbers (owner, 5 Nov 2026): Accounting and the Admin set the Form No., Revision No., Revision Date
 * and Issued Date of every form. The dates are text because existing forms print values such as "00".
 * A form with all four blank prints no details. Certificates are not listed: they print from approved templates.
 */
export type DocumentControl = { formNo: string; revisionNo: string; revisionDate: string; issuedDate: string };

export const FORM_GROUPS = ["Accounting", "Cashier", "Registration", "Training and MISMO", "Payroll"] as const;
type Form = { code: string; name: string; group: (typeof FORM_GROUPS)[number]; start?: Partial<DocumentControl>; note?: string };

export const DOCUMENT_FORMS = [
  { code: "expense_voucher", name: "Expense Voucher", group: "Accounting", start: { revisionNo: "01", issuedDate: "11/05/2026" } },
  { code: "expenses_summary", name: "Expenses Summary", group: "Accounting" },
  { code: "billing_statement", name: "Billing Statement", group: "Accounting", start: { formNo: "NW-FMGR-04-24", issuedDate: "12/03/2025" } },
  { code: "company_receipt", name: "Company Receipt", group: "Accounting", start: { formNo: "NW-FMGR-04-24", issuedDate: "12/03/2025" } },
  { code: "cash_sales_summary", name: "Cash and Sales Summary", group: "Accounting" },
  { code: "endorsed_courses", name: "Endorsed Courses", group: "Accounting" },
  { code: "reconciliation", name: "Payment Reconciliation Sheet", group: "Accounting" },
  { code: "ack_receipt", name: "Acknowledgement Receipt", group: "Cashier" },
  { code: "cashier_report", name: "Cashier Summary Report", group: "Cashier" },
  { code: "tar", name: "Training Admission Record", group: "Registration" },
  { code: "terms", name: "Terms and Conditions", group: "Registration", start: { revisionNo: "03", revisionDate: "11/05/2026", issuedDate: "11/05/2026" } },
  { code: "enrollment_record", name: "Enrollment Record", group: "Registration" },
  { code: "instructions", name: "Training Instructions", group: "Registration" },
  { code: "completion_record", name: "Completion Record", group: "Training and MISMO", start: { formNo: "05-00", revisionDate: "00", issuedDate: "09-14-2023" }, note: "Prints as AD No. and Initial Issue Date" },
  { code: "mismo_final", name: "MISMO Final List", group: "Training and MISMO" },
  { code: "mismo_unsettled", name: "MISMO Not Settled List", group: "Training and MISMO" },
  { code: "batch_roster", name: "Batch Roster", group: "Training and MISMO" },
  { code: "resource_plan", name: "Resource Plan", group: "Training and MISMO" },
  { code: "payslip", name: "Payslip", group: "Payroll" },
] as const satisfies readonly Form[];

export type FormCode = (typeof DOCUMENT_FORMS)[number]["code"];
export const isFormCode = (code: string): code is FormCode => DOCUMENT_FORMS.some((f) => f.code === code);

export const BLANK_CONTROL: DocumentControl = { formNo: "", revisionNo: "", revisionDate: "", issuedDate: "" };
export const startControl = (code: FormCode): DocumentControl => ({ ...BLANK_CONTROL, ...((DOCUMENT_FORMS.find((f) => f.code === code) as Form | undefined)?.start ?? {}) });
export const controlIsSet = (c: DocumentControl | null | undefined) => !!c && !!(c.formNo || c.revisionNo || c.revisionDate || c.issuedDate);

/** The four rows as printed. Empty when all four are blank, unless `always` (the voucher keeps its block). */
export const controlRows = (c: DocumentControl | null | undefined, always = false): [string, string][] => {
  if (!always && !controlIsSet(c)) return [];
  return [["Form No.", c?.formNo ?? ""], ["Revision No.", c?.revisionNo ?? ""], ["Revision Date", c?.revisionDate ?? ""], ["Issued Date", c?.issuedDate ?? ""]];
};

/** One line, for headers with no free corner. Blank details are left out. */
export const controlLine = (c: DocumentControl | null | undefined) => controlRows(c).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join("  |  ");

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Row = { form_no: string | null; revision_no: string | null; revision_date: string | null; issued_date: string | null };

/** The form's saved details; the starting values until migration 202610290078 is run. */
export async function loadDocumentControl(db: Admin, code: FormCode): Promise<DocumentControl> {
  const { data, error } = await db.from("document_controls").select("form_no,revision_no,revision_date,issued_date").eq("form_code", code).maybeSingle();
  if (error || !data) return startControl(code);
  const r = data as Row;
  return { formNo: r.form_no ?? "", revisionNo: r.revision_no ?? "", revisionDate: r.revision_date ?? "", issuedDate: r.issued_date ?? "" };
}
