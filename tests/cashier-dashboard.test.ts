import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CashierDashboard, paidSections } from "@/components/portal/live-cashier";
import { manilaToday } from "@/lib/portal-format";

const today = manilaToday();
const enrollment = (id: string, traineeId: string, name: string, code: string, price: number, paid: number) => ({
  id, trainee_id: traineeId, course_id: code, enrollment_number: `ENR-${id}`, enrollment_status: "Enrolled", selling_price_centavos: price, charges_centavos: 0, discounts_centavos: 0, paid_centavos: paid, created_at: `${today}T01:00:00Z`,
  trainees: { legal_first_name: name, legal_last_name: "SAMPLE", trainee_number: `T-${traineeId}` }, courses: { code, name: `${code} Course` }, batches: null,
});
const payment = (id: string, traineeId: string, amount: number) => ({ id, trainee_id: traineeId, payment_number: `PAY-${id}`, amount_centavos: amount, method: "GCash", reference_number: "884422", received_at: `${today}T02:00:00Z` });
const data = {
  roles: ["cashier"], courses: [], requests: [], expenses: [], expenseReprints: [], cashierOpenings: [], cashierClosings: [], offers: [], paymentMethods: [], handedToCashier: {}, companyCharge: {}, pendingRebates: {},
  applicationNumbers: { owes: "NWMTACI-0000001", done: "NWMTACI-0000002", many: "NWMTACI-0000003" }, receiptPrints: { pay2: 2 },
  enrollments: [enrollment("e1", "owes", "OWES", "BTR", 220000, 110000), enrollment("e2", "owes", "OWES", "APA", 100000, 100000), enrollment("e3", "done", "DONE", "APA", 60000, 60000), enrollment("e4", "many", "MANY", "SSO", 90000, 90000)],
  payments: [payment("pay1", "owes", 210000), payment("pay2", "done", 60000), payment("pay3", "many", 90000)],
  traineeProofs: [{ id: "f1", trainee_id: "owes", name: "SAMPLE, PROOF", number: "NWMTACI-0000001", method: "GCash", reference: "12345", amount_centavos: 90000, submitted_at: `${today}T03:47:00Z`, drive_link: "https://drive.google.com/file/d/sample" }],
};
const render = () => renderToStaticMarkup(createElement(CashierDashboard, { data: data as never, onPay: () => undefined, reload: async () => undefined, onOpenTrainee: () => undefined }));

describe("Paid and Enrolled, Balance First", () => {
  it("keeps who still owes in view and folds everyone fully paid into one total", () => {
    const groups = [{ name: "A", balance: 110000, paid: 210000 }, { name: "B", balance: 0, paid: 60000 }, { name: "C", balance: 0, paid: 90000 }];
    const s = paidSections(groups);
    expect(s.withBalance.map((g) => g.name)).toEqual(["A"]);
    expect(s.fullyPaid.map((g) => g.name)).toEqual(["B", "C"]);
    expect(s.fullyPaidTotal).toBe(150000);
  });
  it("shows the trainee with a balance, a course count and no course list, and hides the fully paid until asked", () => {
    const html = render();
    expect(html).toContain("With Balance · 1");
    expect(html).toContain("2 Courses");
    expect(html).toContain("Record ₱1,100");
    expect(html).toContain("2 Fully Paid");
    expect(html).toContain("Show ▾");
    expect(html).not.toContain("SAMPLE, DONE");
    expect(html).not.toContain("BTR Course");
  });
  it("gives a proof one line: mode and reference together, Not Valid in the Actions menu, no course list", () => {
    const html = render();
    expect(html).toContain("Proofs of Payment");
    expect(html).toContain("12345");
    // Not Valid moved into Actions ▾ (owner, 10 Nov 2026: "not so much buttons"); the menu opens on click.
    expect(html).toContain("Actions ▾");
    expect(html).not.toContain(">Not Valid<");
  });
});
