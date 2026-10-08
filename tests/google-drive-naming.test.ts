import { describe, expect, it } from "vitest";
import { nextFreeName, proofNaming } from "@/lib/google-drive";

describe("proof of payment naming in Google Drive", () => {
  it("files under Mode › Month as LASTNAME - Manila date", () => {
    // 11:30 PM UTC on Oct 31 is Nov 1 in Manila.
    const n = proofNaming({ mode: "GCash", receivedAt: "2026-10-31T23:30:00Z", lastName: "dela Cruz", mime: "image/jpeg" });
    expect(n.monthLabel).toBe("2026-11 November");
    expect(n.monthKey).toBe("GCash/2026-11");
    expect(n.fileName).toBe("DELA CRUZ - 2026-11-01.jpg");
  });

  it("keeps the extension of PDFs and strips characters Drive names dislike", () => {
    const n = proofNaming({ mode: "PSBank", receivedAt: "2026-10-07T02:00:00Z", lastName: "Peña/Ruiz", mime: "application/pdf" });
    expect(n.fileName).toBe("PENA RUIZ - 2026-10-07.pdf");
  });

  it("adds (2), (3) when the name is already in the month folder", () => {
    expect(nextFreeName("REYES - 2026-10-07", "jpg", [])).toBe("REYES - 2026-10-07.jpg");
    expect(nextFreeName("REYES - 2026-10-07", "jpg", ["REYES - 2026-10-07.jpg"])).toBe("REYES - 2026-10-07 (2).jpg");
    expect(nextFreeName("REYES - 2026-10-07", "jpg", ["reyes - 2026-10-07.jpg", "REYES - 2026-10-07 (2).jpg"])).toBe("REYES - 2026-10-07 (3).jpg");
  });
});
