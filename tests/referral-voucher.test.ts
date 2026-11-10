import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { referralRebateTotal, voucherRows, voucherStatus, voucherTotal, type RebateForVoucher } from "@/lib/referral-voucher";
import { createReferralVoucherPdf } from "@/lib/print/referral-voucher";

// Referral Voucher, Design 1 and Freelance partners (owner, 10 Nov 2026).
const r = (status: string, created: string, last: string, code: string, rebate: number): RebateForVoucher => ({ status, rebate_centavos: rebate, enrollments: { created_at: created }, trainees: { legal_first_name: "Juan", legal_middle_name: "P", legal_last_name: last }, courses: { code, name: `${code} course` } });

describe("Referral Voucher lines", () => {
  it("lists the partner's trainees enrolled in the period (Manila days), oldest first, leaving out cancelled rebates", () => {
    const rows = voucherRows([
      r("Pending", "2026-11-03T02:00:00Z", "Santos", "PSCMT", 30000),
      r("Paid", "2026-10-31T16:30:00Z", "Dela Cruz", "UBT-PSSR", 50000), // Nov 1, 00:30 in Manila
      r("Cancelled", "2026-11-04T02:00:00Z", "Reyes", "UBT-PSSR", 50000),
      r("Pending", "2026-10-31T15:00:00Z", "Garcia", "UBT-PSSR", 50000), // Oct 31 in Manila
      r("Pending", "2026-11-11T02:00:00Z", "Tan", "PSCMT", 30000),
    ], "2026-11-01", "2026-11-10");
    expect(rows.map((x) => [x.enrolledOn, x.trainee, x.courseCode, x.rebateCentavos])).toEqual([
      ["2026-11-01", "DELA CRUZ, JUAN P", "UBT-PSSR", 50000],
      ["2026-11-03", "SANTOS, JUAN P", "PSCMT", 30000],
    ]);
    expect(voucherTotal(rows)).toBe(80000);
  });
  it("prints one A4 page with the details, total and signatures", async () => {
    const bytes = await createReferralVoucherPdf({ number: "RV-2026-000001", issuedOn: "2026-11-10", partner: "Sample Agency", kind: "Freelance", referralCode: "SAMPL482913", contact: "Sample Contact - 0917 000 0000", from: "2026-11-01", to: "2026-11-10",
      rows: [{ enrolledOn: "2026-11-02", trainee: "DELA CRUZ, JUAN P", courseCode: "UBT-PSSR", course: "Basic Training", rebateCentavos: 50000 }], totalCentavos: 50000, preparedBy: "Sample Accountant" });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    if (process.env.OUT_PDF) writeFileSync(process.env.OUT_PDF, bytes);
  });
});

describe("Issuing and Freelance", () => {
  const route = readFileSync("app/api/staff/operations/route.ts", "utf8");
  const sql = readFileSync("supabase/migrations/202610290088_freelance_referral_vouchers.sql", "utf8");
  it("lets the Cashier prepare it, Accounting approve it and the Cashier release it, and keeps the voucher as issued", () => {
    const issue = route.slice(route.indexOf('if (input.action === "referral-voucher-issue") {'), route.indexOf('if (input.action === "referral-voucher-decide" || input.action === "referral-voucher-release") {'));
    const flow = route.slice(route.indexOf('if (input.action === "referral-voucher-decide" || input.action === "referral-voucher-release") {'), route.indexOf('if (input.action === "billing-statement-issue") {'));
    expect(issue).toContain("if (!canCashier(staff.roleCodes))");
    expect(issue).toContain('status: "For Approval"');
    expect(flow).toContain("deciding ? !canManageAccounting(staff.roleCodes) : !canCashier(staff.roleCodes)");
    expect(flow).toContain('Accounting approves the voucher before it is released.');
    expect(flow).toContain('.update({ status: "Paid", settlement: `Paid by Referral Voucher');
    expect(readFileSync("supabase/migrations/202610290091_referral_voucher_flow.sql", "utf8")).toContain("referral_voucher_events_immutable before update or delete");
    expect(issue).toContain('admin.rpc("next_reference", { prefix: "RV" })');
    expect(issue).toContain('action: "referral_voucher.issued"');
    expect(readFileSync("app/api/documents/referral-voucher/[id]/route.ts", "utf8")).toContain('["admin", "accounting", "cashier"].includes(role)');
    expect(sql).toContain("referral_vouchers_immutable before update or delete");
  });
  it("adds Freelance as a partner type everywhere partners are chosen", () => {
    expect(sql).toContain("check (kind in ('Agency', 'Consultancy', 'Freelance'))");
    expect(route).toContain('kind: z.enum(["Agency", "Consultancy", "Freelance"]).optional()');
    expect(readFileSync("components/portal/live-accounting.tsx", "utf8").match(/<option>Freelance<\/option>/g)).toHaveLength(2);
    expect(readFileSync("lib/cashier-report.ts", "utf8")).toContain('"Consultancies", "Freelance"');
    expect(readFileSync("components/portal/accounting-home.tsx", "utf8")).toContain('onClick={() => setVoucherOpen((v) => !v)}>Referral Voucher</button>');
  });
});

describe("Receipt shows the full fee and the voucher status", () => {
  it("counts only referral rebates as paid, never other discounts", () => {
    expect(referralRebateTotal([
      { event_type: "discount", description: "Referral rebate (Sample Agency)", amount_centavos: 50000 },
      { event_type: "discount", description: "Senior discount", amount_centavos: 10000 },
      { event_type: "charge", description: "Referral rebate (fake)", amount_centavos: 999 },
    ])).toBe(50000);
    const page = readFileSync("app/portal/payment-receipt/[id]/page.tsx", "utf8");
    expect(page).toContain('x.event_type === "discount" && !isReferralRebate(x)');
    expect(page).toContain("const paid = rebate + ");
    expect(readFileSync("app/api/documents/payment/[id]/route.ts", "utf8")).toContain("+rebate,");
  });
  it("takes the latest event as the status and waits for Accounting when there is none", () => {
    expect(voucherStatus([])).toBe("For Approval");
    expect(voucherStatus([{ status: "For Approval", created_at: "2026-11-10T01:00:00Z" }, { status: "Released", created_at: "2026-11-10T03:00:00Z" }, { status: "Approved", created_at: "2026-11-10T02:00:00Z" }])).toBe("Released");
    expect(voucherRows([{ ...r("Pending", "2026-11-03T02:00:00Z", "Santos", "PSCMT", 30000), id: "a" }], "2026-11-01", "2026-11-10", new Set(["a"]))).toEqual([]);
  });
});
