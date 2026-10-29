import { describe, expect, it } from "vitest";
import { sameTrainee, tarPrintable } from "@/lib/trainee-match";

describe("TAR courses", () => {
  it("prints scheduled courses, paid or with a balance, never cancelled or unscheduled ones", () => {
    expect(tarPrintable({ enrollment_status: "Enrolled", batch_id: "b" })).toBe(true);
    expect(tarPrintable({ enrollment_status: "Pending", batch_id: "b" })).toBe(true);
    expect(tarPrintable({ enrollment_status: "Pending", scheduled_on: "2026-11-03" })).toBe(true);
    expect(tarPrintable({ enrollment_status: "Pending" })).toBe(false);
    expect(tarPrintable({ enrollment_status: "Cancelled", batch_id: "b" })).toBe(false);
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
