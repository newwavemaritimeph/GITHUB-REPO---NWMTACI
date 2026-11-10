import { describe, expect, it } from "vitest";
import { newArrivals } from "@/lib/portal-alerts";

describe("new-arrival chime", () => {
  it("never chimes on the first load", () => {
    expect(newArrivals(null, { enrollments: [{ id: "e1" }] }, "registration").count).toBe(0);
  });
  it("chimes Registration for new enrollments and new trainees waiting for a course", () => {
    const r = newArrivals({ enrollments: [{ id: "e1" }], awaitingCourseIds: [] }, { enrollments: [{ id: "e1" }, { id: "e2" }], awaitingCourseIds: ["t9"] }, "registration");
    expect(r).toEqual({ count: 2, label: "2 New Registrations" });
  });
  it("chimes the Cashier for new payment proofs and hand-overs, not for removed rows", () => {
    const prev = { traineeProofs: [{ id: "p1" }, { id: "p2" }], handedToCashier: { e1: "t" } };
    expect(newArrivals(prev, { traineeProofs: [{ id: "p2" }, { id: "p3" }], handedToCashier: { e1: "t", e2: "t" } }, "cashier")).toEqual({ count: 2, label: "New Payment · New Hand-Over" });
    expect(newArrivals(prev, { traineeProofs: [{ id: "p2" }], handedToCashier: {} }, "cashier").count).toBe(0);
  });
  it("stays quiet for other roles", () => {
    expect(newArrivals({ enrollments: [] }, { enrollments: [{ id: "e1" }] }, "accounting").count).toBe(0);
  });
  it("chimes for the Releasing Officer on new certificates and for MISMO on new enrollments", () => {
    expect(newArrivals({ certificates: [{ id: "c1" }] }, { certificates: [{ id: "c1" }, { id: "c2" }] }, "releasing_officer")).toEqual({ count: 1, label: "New Certificate" });
    expect(newArrivals({ enrollments: [] }, { enrollments: [{ id: "e1" }, { id: "e2" }] }, "mismo_officer")).toEqual({ count: 2, label: "2 New Enrollments" });
  });
});
