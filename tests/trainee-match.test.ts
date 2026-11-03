import { describe, expect, it } from "vitest";
import { sameTrainee, tarGroups, tarPrintable } from "@/lib/trainee-match";

describe("TAR courses", () => {
  it("prints every course that is not cancelled, paid or not", () => {
    expect(tarPrintable({ enrollment_status: "Enrolled" })).toBe(true);
    expect(tarPrintable({ enrollment_status: "Pending" })).toBe(true);
    expect(tarPrintable({ enrollment_status: "Open Schedule" })).toBe(true);
    expect(tarPrintable({ enrollment_status: "Cancelled" })).toBe(false);
  });
});

describe("same trainee, two records", () => {
  const a = { id: "1", srn: "1234567890", legal_first_name: "Juan", legal_last_name: "Maneje", birthdate: "1990-01-02" };
  it("matches on SRN, or on name and birth date", () => {
    expect(sameTrainee(a, { id: "2", srn: "1234567890" })).toBe(true);
    expect(sameTrainee(a, { id: "3", srn: null, legal_first_name: "juan", legal_last_name: "MANEJE ", birthdate: "1990-01-02" })).toBe(true);
    expect(sameTrainee(a, { id: "4", srn: null, legal_first_name: "Juan", legal_last_name: "Maneje", birthdate: "1991-01-02" })).toBe(false);
    expect(sameTrainee(a, a)).toBe(false);
  });
});

describe("one TAR per enrollment date", () => {
  it("groups courses enrolled on the same Manila day, newest first, and leaves out cancelled ones", () => {
    const rows = [
      { id: "bt", enrollment_status: "Enrolled", enrolled_at: "2026-11-02T03:00:00Z", created_at: "2026-11-01T01:00:00Z" },
      { id: "sso", enrollment_status: "Enrolled", enrolled_at: "2026-11-03T01:00:00Z", created_at: "2026-11-03T00:30:00Z" },
      { id: "crowd", enrollment_status: "Pending", enrolled_at: null, created_at: "2026-11-02T17:30:00Z" },
      { id: "gone", enrollment_status: "Cancelled", enrolled_at: null, created_at: "2026-11-03T02:00:00Z" },
    ];
    // 2026-11-02T17:30Z is 1:30 AM on Nov 3 in Manila.
    expect(tarGroups(rows)).toEqual([{ date: "2026-11-03", ids: ["crowd", "sso"] }, { date: "2026-11-02", ids: ["bt"] }]);
  });
});
