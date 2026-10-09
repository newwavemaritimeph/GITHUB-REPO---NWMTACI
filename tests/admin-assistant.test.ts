import { describe, expect, it } from "vitest";
import { accreditationFor, planIssues, requisitionState, requisitionTotal } from "@/lib/admin-assistant";

describe("requisitions", () => {
  it("adds up quantity × unit cost", () => {
    expect(requisitionTotal([{ description: "Coffee Cups", quantity: 4, unitCentavos: 18000 }, { description: "Coffee Beans", quantity: 2, unitCentavos: 65000 }])).toBe(202000);
    expect(requisitionTotal([])).toBe(0);
  });
  it("reads Released once the Cashier pays the voucher", () => {
    expect(requisitionState({ status: "For Approval" })).toBe("For Approval");
    expect(requisitionState({ status: "Approved", expense_status: "Approved" })).toBe("Approved");
    expect(requisitionState({ status: "Approved", expense_status: "Paid" })).toBe("Released");
    expect(requisitionState({ status: "Rejected", expense_status: "Paid" })).toBe("Rejected");
  });
});

describe("resource planning", () => {
  const acc = [{ instructor_id: "i1", course_id: "c1", valid_until: "2026-12-31" }, { instructor_id: "i1", course_id: "c2", valid_until: "2026-09-30" }, { instructor_id: "i2", course_id: "c1", valid_until: null }];
  it("checks accreditation for the course on the start date", () => {
    expect(accreditationFor(acc, "i1", "c1", "2026-10-10")).toBe("ok");
    expect(accreditationFor(acc, "i1", "c2", "2026-10-10")).toBe("expired");
    expect(accreditationFor(acc, "i1", "c3", "2026-10-10")).toBe("none");
    expect(accreditationFor(acc, "i2", "c1", "2030-01-01")).toBe("ok");
  });
  it("warns about missing room, capacity and accreditation", () => {
    expect(planIssues({ students: 20, startsOn: "2026-10-10", courseId: "c1", classroom: { capacity: 24 }, instructorId: "i1", accreditations: acc })).toEqual([]);
    expect(planIssues({ students: 26, startsOn: "2026-10-10", courseId: "c1", classroom: { capacity: 24 }, instructorId: "i1", accreditations: acc })).toEqual(["Students exceed room capacity (24)"]);
    expect(planIssues({ students: 5, startsOn: "2026-10-10", courseId: "c2", classroom: null, instructorId: "i1", accreditations: acc })).toEqual(["No classroom", "Accreditation expired"]);
    expect(planIssues({ students: 5, startsOn: "2026-10-10", courseId: "c3", classroom: { capacity: 12 }, instructorId: null, accreditations: acc })).toEqual(["No instructor"]);
  });
});

import { planRows, rangesOverlap, isBlocking } from "@/lib/admin-assistant";
describe("resource plan conflicts", () => {
  const base = { courseName: "", students: 10, capacity: 24 };
  const batches = [
    { ...base, id: "a", batchNumber: "B1", courseId: "c1", courseCode: "UBT", startsOn: "2026-10-12", endsOn: "2026-10-12", classroomId: "r1", instructorId: "i1" },
    { ...base, id: "b", batchNumber: "B2", courseId: "c2", courseCode: "CCMD", startsOn: "2026-10-12", endsOn: "2026-10-14", classroomId: "r1", instructorId: "i2" },
    { ...base, id: "c", batchNumber: "B3", courseId: "c1", courseCode: "UBT", startsOn: "2026-10-15", endsOn: "2026-10-15", classroomId: "r1", instructorId: "i1" },
  ];
  const acc = [{ instructor_id: "i1", course_id: "c1", valid_until: null }, { instructor_id: "i2", course_id: "c2", valid_until: null }];
  it("finds rooms booked twice on the same days", () => {
    expect(rangesOverlap("2026-10-12", "2026-10-14", "2026-10-14", "2026-10-15")).toBe(true);
    expect(rangesOverlap("2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15")).toBe(false);
    const rows = planRows(batches, [{ id: "r1", name: "ROOM 101", capacity: 24 }], [{ id: "i1", complete_name: "Capt. A" }, { id: "i2", complete_name: "C/E B" }], acc);
    expect(rows[0].roomClash?.id).toBe("b");
    expect(rows[2].roomClash).toBeNull();
    expect(rows[0].issues.some(isBlocking)).toBe(true);
    expect(rows[2].issues).toEqual([]);
  });
});
