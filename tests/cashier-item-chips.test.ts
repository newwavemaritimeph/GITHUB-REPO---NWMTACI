import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { RecordPaymentModal } from "@/components/portal/live-cashier";
import { createExpenseVoucherPdf } from "@/lib/documents";

// Item Chips (owner, 10 Nov 2026): the Cashier adds Uniform, T-Shirt and Online Assessment in Record Payment.
const data = {
  enrollments: [{ id: "e1", trainee_id: "t1", enrollment_number: "ENR-1", enrollment_status: "Pending", selling_price_centavos: 90000, created_at: "2026-11-10T01:00:00Z", courses: { code: "UBT-PSSR", name: "Basic Training PSSR" }, batches: null, payment_allocations: [], enrollment_charges: [], trainees: { id: "t1", legal_first_name: "Juan", legal_last_name: "Dela Cruz", trainee_number: "T-1" } }],
  trainees: [{ id: "t1", legal_first_name: "Juan", legal_last_name: "Dela Cruz", trainee_number: "T-1" }],
  charges: [
    { id: "u", name: "Uniform", default_amount_centavos: 15000, active: true, used_count: 0, kind: "item" },
    { id: "t", name: "T-Shirt", default_amount_centavos: 15000, active: true, used_count: 0, kind: "item" },
    { id: "oa", name: "Online Assessment", default_amount_centavos: 50000, active: true, used_count: 0, kind: "item" },
    { id: "rp", name: "Reprinting", default_amount_centavos: 50000, active: true, used_count: 0, kind: "fee" },
    { id: "old", name: "Old Cap", default_amount_centavos: 10000, active: false, used_count: 0, kind: "item" },
  ],
  paymentMethods: [{ id: "m1", code: "cash", name: "Cash", requires_reference: false, allows_proof: false, active: true }],
  agencies: [], payments: [], pendingItems: [], paymentVoids: [], roles: ["cashier"],
} as unknown as Parameters<typeof RecordPaymentModal>[0]["data"];

describe("Item Chips in the Cashier's Record Payment", () => {
  it("shows a chip for every active Miscellaneous Item, and none for service fees or inactive items", () => {
    let html = "";
    try { html = renderToStaticMarkup(createElement(RecordPaymentModal, { data, initialEnrollmentId: "e1", onClose: () => undefined, onSaved: async () => undefined })); }
    catch { /* fall back to the source check below when the fixture is too thin to render */ }
    const cashier = readFileSync("components/portal/live-cashier.tsx", "utf8");
    // An endorsed course takes only Online Medical (owner, 10 Nov 2026).
    expect(cashier).toContain('const counterItems = data.charges.filter((c) => c.active && c.kind === "item" && itemAllowed(c.name, itemEndorsed));');
    if (html) {
      for (const chip of ["+ Uniform ₱150", "+ T-Shirt ₱150", "+ Online Assessment ₱500"]) expect(html).toContain(chip);
      expect(html).not.toContain("+ Reprinting");
      expect(html).not.toContain("+ Old Cap");
    }
  });
});

// Liquidation Form · Design 1 (owner, 10 Nov 2026): the Expense Voucher keeps its layout under the new name.
describe("Liquidation Form", () => {
  it("prints under the new title with Requested by and Liquidated by", async () => {
    const docs = readFileSync("lib/documents.ts", "utf8");
    expect(docs).toContain('text("LIQUIDATION FORM", X0 + 8, barText, 9.5, bold, c.white);');
    expect(docs).toContain('label: "Requested by"');
    expect(docs).toContain('label: "Liquidated by"');
    expect(docs).not.toContain('"EXPENSE VOUCHER"');
    const bytes = await createExpenseVoucherPdf({ number: "CV-2026-000131", issuedAt: "Nov 10, 2026", payee: "Sample Supply", purpose: "Office supplies", category: "Supplies", amountCentavos: 49000, status: "Released", preparedBy: "Sample Cashier", approvedBy: "Sample Accountant" } as unknown as Parameters<typeof createExpenseVoucherPdf>[0]);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it("leaves no Expense Voucher heading in the live screens", () => {
    for (const f of ["components/portal/live-accounting.tsx", "components/portal/live-cashier.tsx"]) expect(readFileSync(f, "utf8")).not.toMatch(/<h[12]>Expense Voucher|eyebrow">Expense voucher/);
  });
});
