import { describe, expect, it } from "vitest";
import { bsNumber, coverageLabel, statementTotal, trainingStatus } from "@/lib/billing-statement";

describe("billing statement", () => {
  it("reads the training status from the dates", () => {
    expect(trainingStatus("2026-10-01", "2026-10-03", "2026-10-22")).toBe("Completed");
    expect(trainingStatus("2026-10-20", "2026-10-24", "2026-10-22")).toBe("Ongoing");
    expect(trainingStatus("2026-10-26", "2026-10-26", "2026-10-22")).toBe("Scheduled");
    expect(trainingStatus(null, null, "2026-10-22")).toBe("No Schedule");
  });
  it("numbers and totals the statement", () => {
    expect(bsNumber(29)).toBe("000029");
    expect(coverageLabel("2026-08-21", "2026-09-20")).toBe("Aug 21 - Sep 20, 2026 (as per date enrolled)");
    expect(statementTotal([{ enrolled: "", name: "", training: "", status: "", amount: 60000 }, { enrolled: "", name: "", training: "", status: "", amount: 110000 }])).toBe(170000);
  });
});
