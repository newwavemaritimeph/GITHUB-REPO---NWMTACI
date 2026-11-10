import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TraineeProfileView, type TraineeProfile } from "@/components/portal/batch-window";

const route = readFileSync("app/api/staff/operations/route.ts", "utf8");
const profileRoute = readFileSync("app/api/staff/trainee-profile/route.ts", "utf8");

// Owner, 10 Nov 2026: "Add Void in Vouchers, Expenses, Payments and such (Applicable to Accounting only)."
describe("Void for Accounting", () => {
  it("lets Accounting or the Admin void payments, vouchers and other income, and keeps cancelling with the Admin", () => {
    const at = route.indexOf('if (input.action === "payment-void" || input.action === "expense-void"'), gate = route.slice(at, at + 600);
    expect(gate).toContain('input.action === "enrollment-cancel" ? !isAdminRole(staff.roleCodes) : !canManageAccounting(staff.roleCodes)');
    const income = route.slice(route.indexOf('if (input.action === "income-void") {'), route.indexOf('if (input.action === "income-void") {') + 200);
    expect(income).toContain("!canManageAccounting(staff.roleCodes)");
    expect(route).toContain('const canManageAccounting = (roles: string[]) => roles.some((role) => ["admin", "accounting"].includes(role));');
  });
  it("puts Void on Accounting's Payments, Expenses and Expense Vouchers", () => {
    const home = readFileSync("components/portal/accounting-home.tsx", "utf8"), vouchers = readFileSync("components/portal/live-accounting.tsx", "utf8");
    expect(home).toContain('action: "payment-void", paymentId: id, reason');
    expect(home).toContain('action: "expense-void", id: e.id, reason');
    expect(vouchers).toContain('action: "expense-void", id: v.id, reason');
  });
});

describe("Trainee Account from a name in the Batch window", () => {
  it("is read-only, has no payments, and is open to the MISMO Compliance Officer", () => {
    expect(profileRoute).toContain('"mismo_officer"');
    expect(profileRoute).not.toMatch(/from\("payment|insert\(|update\(|delete\(/);
  });
  it("shows every trainee detail and no action buttons", () => {
    const p: TraineeProfile = { name: "DELA CRUZ, JUAN PEREZ", nwmtaciNo: "NWMTACI-0000031", traineeNo: "T-1", srn: "8512250011", rank: "Ordinary Seaman", birthdate: "1990-01-02", placeOfBirth: "Manila", sex: "Male", nationality: "Filipino", address: "Ermita, Manila", mobile: "0917 000 0031", email: "juan@example.com", company: "Sample Shipping", emergencyName: "Maria Dela Cruz", emergencyMobile: "0917 000 0032",
      courses: [{ id: "e1", code: "UBT-PSSR", name: "Basic Training", batch: "26-609-146", startsOn: "2026-11-17", endsOn: "2026-11-21", status: "Enrolled" }] };
    const html = renderToStaticMarkup(createElement(TraineeProfileView, { p }));
    for (const text of ["Birth Date", "Place of Birth", "Manila", "Rank", "Ordinary Seaman", "Emergency Contact", "Maria Dela Cruz", "Nationality", "Sex", "SRN", "UBT-PSSR", "26-609-146"]) expect(html).toContain(text);
    expect(html).not.toContain("<button");
  });
});
