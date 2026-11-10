import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DOCUMENT_FORMS, controlIsSet, controlLine, controlRows, isFormCode, startControl } from "@/lib/document-controls";
import { createExpenseVoucherPdf } from "@/lib/documents";
import { PDFDocument } from "pdf-lib";

// Forms added later get their row in a later migration (202610290086: the Training Reports sheets).
const migration = ["202610290078_document_controls.sql", "202610290086_course_exercises.sql", "202610290088_freelance_referral_vouchers.sql"].map((f) => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n");

describe("Form Numbers", () => {
  it("has one row per form, the same in the code and the migration", () => {
    const codes = DOCUMENT_FORMS.map((f) => f.code);
    expect(codes).toHaveLength(23);
    expect(new Set(codes).size).toBe(23);
    for (const code of codes) expect(migration).toContain(`('${code}',`);
    expect(isFormCode("expense_voucher")).toBe(true);
    expect(isFormCode("certificate")).toBe(false);
  });
  it("starts the voucher with the owner's values and keeps what other forms print today", () => {
    expect(startControl("expense_voucher")).toEqual({ formNo: "", revisionNo: "01", revisionDate: "", issuedDate: "11/05/2026" });
    expect(startControl("billing_statement")).toMatchObject({ formNo: "NW-FMGR-04-24", issuedDate: "12/03/2025" });
    expect(startControl("terms")).toMatchObject({ revisionNo: "03", revisionDate: "11/05/2026", issuedDate: "11/05/2026" });
    expect(startControl("completion_record")).toEqual({ formNo: "05-00", revisionNo: "", revisionDate: "00", issuedDate: "09-14-2023" });
    expect(controlIsSet(startControl("payslip"))).toBe(false);
  });
  it("prints nothing when all four are blank", () => {
    expect(controlRows(startControl("payslip"))).toEqual([]);
    expect(controlLine(startControl("payslip"))).toBe("");
    expect(controlRows(startControl("payslip"), true).map(([k]) => k)).toEqual(["Form No.", "Revision No.", "Revision Date", "Issued Date"]);
    expect(controlLine(startControl("expense_voucher"))).toBe("Revision No. 01  |  Issued Date 11/05/2026");
  });
  it("is read by the page or route of every form", () => {
    const files = ["app/api/documents/referral-voucher/[id]/route.ts", "app/api/documents/billing-statement/route.ts", "app/api/documents/company-receipt/[id]/route.ts", "app/api/documents/finance-summary/route.ts", "app/api/documents/endorsed-sales/route.ts", "app/api/documents/reconciliation/route.ts", "app/api/documents/expenses-daily/route.ts", "app/api/documents/expenses-summary/route.ts", "app/api/documents/cashier-report/route.ts", "app/api/documents/admission-invoice/[id]/route.ts", "app/api/documents/mismo/route.ts", "app/api/documents/batch-roster/route.ts", "app/api/documents/resource-plan/route.ts", "app/api/documents/payslip/[id]/route.ts", "app/portal/admission-record/[id]/page.tsx", "app/portal/payment-receipt/[id]/page.tsx", "lib/expense-voucher.ts", "lib/training-instructions.ts", "lib/completion-record-server.ts", "lib/training-sheets.ts"];
    const source = files.map((f) => readFileSync(f, "utf8")).join("\n");
    for (const f of DOCUMENT_FORMS) expect(source, f.code).toContain(`"${f.code}"`);
  });
  it("keeps the voucher on one page with its five-row block and a long Form No.", async () => {
    const voucher = { number: "CV-2026-000124", requestNumber: "ER-2026-000031", issuedAt: "Nov 5, 2026", payee: "Meralco", category: "Utilities", purpose: "Electric bill", amountCentavos: 100000, lines: Array.from({ length: 10 }, (_, i) => ({ description: `Line ${i + 1} ${"long description ".repeat(6)}`, quantity: 1, unitCentavos: 10000 })), paymentChannel: "GCash", referenceNumber: "1029", supportingDocument: "", requestedBy: "A", modeOfPayment: "GCash", status: "Approved", preparedBy: "A", preparedAt: "", approvedBy: "B", approvedAt: "", control: { formNo: "NW-A-VERY-LONG-FORM-NUMBER-THAT-KEEPS-GOING", revisionNo: "01", revisionDate: "", issuedDate: "11/05/2026" } };
    const doc = await PDFDocument.load(await createExpenseVoucherPdf(voucher));
    expect(doc.getPageCount()).toBe(1);
  });
});
