import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createExpenseVoucherPdf } from "@/lib/documents";

const closeRoute = readFileSync("app/api/staff/cashier-close/route.ts", "utf8");
const ledgerRoute = readFileSync("app/api/staff/bank-ledger/route.ts", "utf8");

describe("Accounting edits (13 Nov 2026)", () => {
  it("lets only Accounting or the Admin edit a day, with a reason, and works the expected amounts out again", () => {
    expect(closeRoute).toContain('if (!staff.roleCodes.some((r) => ["accounting", "admin"].includes(r)))');
    expect(closeRoute).toContain('reason: z.string().trim().min(5');
    expect(closeRoute).toContain("const f = await dayFigures(db, date, { cash, gcash });");
    expect(closeRoute).toContain('action: "cashier_close.edited"');
  });
  it("edits a bank entry by reversing (or voiding the cheque) and adding the corrected entry", () => {
    expect(ledgerRoute).toContain('z.literal("entry-edit")');
    expect(ledgerRoute).toContain("else await reverse(why);");
    expect(ledgerRoute).toContain("const entryNo = await addEntry(body as Entry, `Corrects ${e.entry_no}: ${body.reason}`);");
    expect(ledgerRoute).toContain("it cannot be edited. Add an adjustment instead.");
  });
  it("prints the Liquidation Form on half of 8.5 x 13 (8.5 x 6.5 in)", async () => {
    const bytes = await createExpenseVoucherPdf({ number: "CV-2026-000131", issuedAt: "Nov 13, 2026", payee: "SAMPLE Supply", purpose: "Supplies", category: "Supplies", amountCentavos: 49000, status: "Released", preparedBy: "SAMPLE", approvedBy: "SAMPLE" } as unknown as Parameters<typeof createExpenseVoucherPdf>[0]);
    const page = (await PDFDocument.load(bytes)).getPage(0);
    expect([page.getWidth(), page.getHeight()]).toEqual([612, 468]);
  });
});
