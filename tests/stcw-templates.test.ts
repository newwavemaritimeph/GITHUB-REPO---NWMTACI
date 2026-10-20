import { describe, expect, it } from "vitest";
import { conductedText } from "../lib/certificate-overlay";
import { bundledLayout } from "../lib/certificate-template-layouts";
import layouts from "../lib/certificate-template-layouts.json";

describe("STCW certificate templates (Safety, Crowd, Crisis)", () => {
  it("fills the training and assessment dates", () => {
    expect(conductedText("Conducted on [START DATE] … assessed … on [ASSESS DATE] in accordance", "2026-10-26", "2026-10-26")).toBe("Conducted on October 26, 2026 … assessed … on October 26, 2026 in accordance");
    expect(conductedText("Conducted from [START DATE] to [END DATE] … on [ASSESS DATE].", "2026-10-27", "2026-10-28")).toBe("Conducted from October 27, 2026 to October 28, 2026 … on October 28, 2026.");
  });
  it("has the three layouts with the issue date and the photo box, and no QR", () => {
    for (const file of ["STPPDSPPS---Safety.pdf", "PSCMT---Crowd-Management.pdf", "PSCMHBT---Crisis-Management.pdf"]) {
      const f = bundledLayout(`course/00000000-0000-0000-0000-000000000000-${file}`)!;
      expect(f.issueDate && f.photo && f.name && f.certNo && f.regNo && f.sans).toBeTruthy();
      expect(f.qr).toBeUndefined();
    }
  });
  it("gives every converted template a 2x2 photo box", () => {
    const all = Object.values(layouts as Record<string, { photo?: { w: number; h: number } }>);
    expect(all.length).toBe(144);
    expect(all.every((f) => f.photo && f.photo.w > 100 && f.photo.h > 100)).toBe(true);
  });
});
