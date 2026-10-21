import { describe, expect, it } from "vitest";
import { groupStatements, payStatus, rebateStatus } from "@/lib/company-charges";

describe("company charge list", () => {
  it("reads the rebate status", () => {
    expect(rebateStatus({ status: "Paid", settlement: "Deducted from the trainee's payment" }, 0)).toBe("Deducted");
    expect(rebateStatus({ status: "Pending", settlement: "Payable to the agency" }, 0)).toBe("Owed to the Partner");
    expect(rebateStatus(null, 30000)).toBe("Not Deducted Yet");
    expect(rebateStatus(null, 0)).toBe("None");
  });
  it("counts a deducted rebate as paid", () => {
    expect(payStatus({ fee: 130000, paid: 65000, rebate: 65000, rebateStatus: "Deducted" })).toBe("Paid");
    expect(payStatus({ fee: 130000, paid: 65000, rebate: 65000, rebateStatus: "Not Deducted Yet" })).toBe("Partly Paid");
    expect(payStatus({ fee: 130000, paid: 0, rebate: 0, rebateStatus: "None" })).toBe("Unpaid");
  });
  it("makes one statement per company, by name", () => {
    const row = (agencyId: string, name: string, startsOn: string) => ({ agencyId, startsOn, name, number: "N", course: "C", training: "T", fee: 100, paid: 0, rebate: 0, rebateStatus: "None" });
    const st = groupStatements([row("b", "Z", "2026-10-02"), row("a", "Y", "2026-10-03"), row("b", "X", "2026-10-01")], new Map([["a", { name: "COSTA MARITIME", kind: "Consultancy", rule: "" }], ["b", { name: "EJV MARITIME", kind: "Consultancy", rule: "" }]]), "Oct", "Oct 22", "2026-10");
    expect(st.map((s) => [s.company, s.statementNo, s.rows.map((r) => r.name).join("")])).toEqual([["COSTA MARITIME", "CCL-2026-10-001", "Y"], ["EJV MARITIME", "CCL-2026-10-002", "XZ"]]);
  });
});
