import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { chargeFigures, sortPayments, sortStatements } from "@/components/portal/company-charge";
import type { ChargePayment, ChargeStatement } from "@/app/api/staff/company-charge/route";
import { formatNumber } from "@/lib/certificate-rules";
import { summarize } from "@/lib/finance-summary";
import { createServiceInvoicePdf } from "@/lib/print/service-invoice";
import { invoiceLines, siFormatProblem, type InvoiceSnapshot } from "@/lib/service-invoice";

const statement = (id: string, billTo: string, issuedAt: string, total: number, paid: number): ChargeStatement => ({ id, agencyId: "a", bsNumber: id, billTo, kind: "Consultancy", from: "2026-10-01", to: "2026-10-31", issuedAt, trainees: 2, total, paid });
const payment = (id: string, billTo: string, receivedAt: string, amount: number): ChargePayment => ({ id, statementId: "s", bsNumber: id, billTo, statementBalance: 0, amount, method: "GCash", reference: "1", receivedAt, proofLink: null, invoiceId: null, siNumber: null });

describe("Service Invoice", () => {
  it("needs the running number in its format, and fills it by the system", () => {
    expect(siFormatProblem("SI-{YYYY}-{N:6}")).toBeNull();
    expect(siFormatProblem("SI-{N}")).toBeNull();
    expect(siFormatProblem("SI-{YYYY}")).toContain("running number");
    expect(formatNumber("SI-{YYYY}-{N:6}", "", 3, new Date("2026-11-05T02:00:00Z"))).toBe("SI-2026-000003");
  });
  it("lists only the trainees this payment settled, with what it applied to each", () => {
    const rows = [{ enrollmentId: "e1", enrolled: "", name: "A", training: "PSCMT", status: "", amount: 180000 }, { enrollmentId: "e2", enrolled: "", name: "B", training: "APA", status: "", amount: 60000 }, { enrolled: "", name: "Old", training: "", status: "", amount: 1 }];
    expect(invoiceLines(rows, new Map([["e1", 100000]]))).toEqual([{ name: "A", training: "PSCMT", amount: 100000 }]);
  });
  it("prints an Original and a Duplicate, and runs onto more pages rather than cutting a line", async () => {
    const snapshot: InvoiceSnapshot = { billTo: "Sample Company", bsNumber: "000031", coverage: "Oct 1 - Oct 31, 2026", paidOn: "November 5, 2026", method: "PSBank", reference: "884422", rows: [{ name: "DELA CRUZ, JUAN", training: "PSCMT", amount: 180000 }], total: 180000, words: "One thousand eight hundred pesos only", tin: "000-000-000-00000", control: { controlNo: "1", formNo: "F-1", revisionNo: "01", revisionDate: "", issuedDate: "11/05/2026" } };
    expect((await PDFDocument.load(await createServiceInvoicePdf("SI-2026-000001", snapshot))).getPageCount()).toBe(2);
    const long = { ...snapshot, rows: Array.from({ length: 60 }, (_, i) => ({ name: `TRAINEE ${i}`, training: "PSCMT", amount: 3000 })) };
    expect((await PDFDocument.load(await createServiceInvoicePdf("SI-2026-000002", long))).getPageCount()).toBeGreaterThan(2);
  });
});

describe("Company Charge list", () => {
  const today = "2026-11-05";
  it("sorts Unpaid oldest first, by company, or highest balance first", () => {
    const rows = [statement("b", "Zeta", "2026-11-03T00:00:00Z", 100, 0), statement("a", "Alpha", "2026-10-01T00:00:00Z", 900, 800), statement("c", "Mid", "2026-11-01T00:00:00Z", 500, 0)];
    expect(sortStatements(rows, "oldest").map((s) => s.id)).toEqual(["a", "c", "b"]);
    expect(sortStatements(rows, "company").map((s) => s.id)).toEqual(["a", "c", "b"]);
    expect(sortStatements(rows, "amount").map((s) => s.id)).toEqual(["c", "a", "b"]);
  });
  it("sorts Paid newest first by default", () => {
    const rows = [payment("old", "A", "2026-10-20T02:00:00Z", 1), payment("new", "B", "2026-11-05T02:00:00Z", 2)];
    expect(sortPayments(rows, "oldest").map((p) => p.id)).toEqual(["new", "old"]);
  });
  it("adds up Unpaid, Paid This Month and Sales Today by the Manila date", () => {
    const f = chargeFigures([statement("a", "A", "2026-10-01T00:00:00Z", 900, 300), statement("b", "B", "2026-10-01T00:00:00Z", 500, 500)], [payment("x", "A", "2026-11-04T15:59:00Z", 300), payment("y", "B", "2026-11-04T16:01:00Z", 500), payment("z", "B", "2026-10-30T02:00:00Z", 70)], today);
    expect(f).toEqual({ unpaidCount: 1, unpaidTotal: 600, paidMonth: 800, salesToday: 500 });
  });
});

describe("Company Charge in the Sales Summary", () => {
  const sale = { endorsement: false, code: "PSCMT", name: "Crowd", center: "", payable: 0, rebate: 0, share: 0, charges: 0, discounts: 0, rebateReceived: 0, category: "STCW" as const };
  it("counts what the company paid as sales, and keeps New Wave plus Endorsed equal to the total", () => {
    const s = summarize({ payments: [], income: [], expenses: [], sales: [{ ...sale, price: 130000, collected: 0 }, { ...sale, price: 50000, collected: 50000, companyCharge: true }] });
    expect(s.companyCharge).toMatchObject({ trainees: 1, sales: 50000, collected: 50000, balance: 0 });
    expect(s.totalSales.sales).toBe(180000);
    expect(s.direct.sales + s.endorsement.sales).toBe(s.totalSales.sales);
  });
});
