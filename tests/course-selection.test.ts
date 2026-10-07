import { describe, expect, it } from "vitest";
import { firstOrderConflict, orderConflict } from "@/lib/course-selection";

const safety = { code: "STPPDSPPS", start: "2026-10-12", end: "2026-10-12" };
const crowd = { code: "PSCMT", start: "2026-10-13", end: "2026-10-14" };
const crisis = { code: "PSCMHBT", start: "2026-10-15", end: "2026-10-17" };

describe("Safety → Crowd → Crisis order on the registration form", () => {
  it("accepts the usual week: Safety Monday, Crowd Tue–Wed, Crisis Thu–Sat", () => {
    expect(firstOrderConflict([safety, crowd, crisis])).toBeNull();
  });
  it("refuses Crowd before Safety", () => {
    expect(orderConflict(crowd, [{ ...safety, start: "2026-10-19", end: "2026-10-19" }])).toMatch(/after your Safety/);
  });
  it("refuses Crisis before Crowd or Safety, and Safety after Crisis", () => {
    expect(orderConflict({ ...crisis, start: "2026-10-08", end: "2026-10-10" }, [safety, crowd])).toMatch(/Safety .* and Crowd/);
    expect(orderConflict({ ...safety, start: "2026-10-19", end: "2026-10-19" }, [crisis])).toMatch(/end before your Crisis/);
  });
  it("ignores courses outside the order", () => {
    expect(orderConflict({ code: "UBT-PSSR", start: "2026-10-08", end: "2026-10-08" }, [crisis])).toBeNull();
  });
});
