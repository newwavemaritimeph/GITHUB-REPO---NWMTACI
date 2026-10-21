import { describe, expect, it } from "vitest";
import { accreditationFor, handles, planIssues, requisitionState, requisitionTotal } from "@/lib/admin-assistant";

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

import { moveTargets, planRows, rangesOverlap, isBlocking } from "@/lib/admin-assistant";
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

describe("instructor and assessor roles", () => {
  const acc = [
    { instructor_id: "a", course_id: "crowd", role: "Instructor and Assessor", valid_until: "2027-01-01" },
    { instructor_id: "b", course_id: "crowd", role: "Assessor", valid_until: "2027-01-01" },
    { instructor_id: "c", course_id: "crowd", valid_until: null },
  ];
  const base = { students: 10, startsOn: "2026-10-27", courseId: "crowd", classroom: { capacity: 24 }, accreditations: acc };
  it("matches the duty to the course role (old rows count as Instructor)", () => {
    expect(handles("Instructor and Assessor", "Assessor")).toBe(true);
    expect(handles(null, "Instructor")).toBe(true);
    expect(handles(null, "Assessor")).toBe(false);
    expect(accreditationFor(acc, "b", "crowd", "2026-10-27", "Instructor")).toBe("none");
    expect(accreditationFor(acc, "b", "crowd", "2026-10-27", "Assessor")).toBe("ok");
  });
  it("flags a missing or unaccredited assessor only where one is needed", () => {
    expect(planIssues({ ...base, instructorId: "c", needsAssessor: true })).toEqual(["No assessor"]);
    expect(planIssues({ ...base, instructorId: "c" })).toEqual([]);
    expect(planIssues({ ...base, instructorId: "c", assessorId: "c" })).toContain("Assessor not accredited for this course");
    expect(planIssues({ ...base, instructorId: "c", assessorId: "b", needsAssessor: true })).toEqual([]);
  });
  it("allows the same person for both only when the role is Instructor and Assessor", () => {
    expect(planIssues({ ...base, instructorId: "a", assessorId: "a", needsAssessor: true })).toEqual([]);
    const two = [...acc, { instructor_id: "b", course_id: "safety", role: "Instructor", valid_until: null }];
    expect(planIssues({ ...base, accreditations: [...two, { instructor_id: "d", course_id: "crowd", role: "Assessor", valid_until: null }], instructorId: "d", assessorId: "d" })).toContain("Same person as instructor and assessor");
  });
});

describe("cancelling a batch", () => {
  const b = (id: string, over: Partial<{ course_id: string; status: string; starts_on: string; confirmed_count: number }> = {}) => ({ id, course_id: "bt", status: "Open", starts_on: "2026-10-24", capacity: 24, confirmed_count: 10, ...over });
  it("offers only open, not-started batches of the same course, flagging those without enough seats", () => {
    const list = [b("src"), b("ok"), b("full", { confirmed_count: 20 }), b("other", { course_id: "crowd" }), b("past", { starts_on: "2026-10-21" }), b("gone", { status: "Cancelled" })];
    const t = moveTargets(list[0], 5, list, "2026-10-21");
    expect(t.map((x) => [x.batch.id, x.left, x.fits])).toEqual([["ok", 14, true], ["full", 4, false]]);
  });
});
