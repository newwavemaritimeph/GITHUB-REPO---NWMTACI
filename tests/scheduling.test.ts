import { describe, expect, it } from "vitest";
import { automaticEndDate, validBatchStart } from "../lib/scheduling";

describe("New Wave batch scheduling", () => {
  it("uses the required weekly start patterns", () => {
    expect(validBatchStart("STPPDSPPS", "1 day", "2026-07-27")).toBe(true);
    expect(validBatchStart("PSCMT", "2 days", "2026-07-28")).toBe(true);
    expect(validBatchStart("PSCMHBT", "3 days", "2026-07-30")).toBe(true);
    expect(validBatchStart("UBT-PSSR", "1 day", "2026-08-01")).toBe(true);
    expect(validBatchStart("UBT-PSSR", "1 day", "2026-08-02")).toBe(false);
  });

  it("calculates 1–6 day patterns without Sunday", () => {
    expect(automaticEndDate("2026-07-27", "1 day")).toBe("2026-07-27");
    expect(automaticEndDate("2026-07-27", "2 days")).toBe("2026-07-28");
    expect(automaticEndDate("2026-07-30", "3 days")).toBe("2026-08-01");
    expect(automaticEndDate("2026-07-27", "4 days")).toBe("2026-07-30");
    expect(automaticEndDate("2026-07-27", "5 days")).toBe("2026-07-31");
    expect(automaticEndDate("2026-07-27", "6 days")).toBe("2026-08-01");
  });
});
