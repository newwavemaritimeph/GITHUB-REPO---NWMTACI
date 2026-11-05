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
    expect(all.length).toBeGreaterThanOrEqual(144);
    expect(all.every((f) => f.photo && f.photo.w > 80 && f.photo.h > 80)).toBe(true);
  });
});

describe("UBT-PSSR training certificate", () => {
  const file = "course/00000000-0000-0000-0000-000000000000-UBT-PSSR---Training-Certificate.pdf";
  it("has the layout of the owner's first page: dates, issued line, bold numbers, photo, no QR", () => {
    const f = bundledLayout(file)!;
    expect(f.conducted?.text).toContain("[START DATE]");
    expect(f.conducted?.text).toContain("[ASSESS DATE]");
    expect(f.issued?.x).toBe(56.55);
    expect(f.certNo?.bold && f.regNo?.bold && f.sans).toBe(true);
    expect(f.photo).toBeTruthy();
    expect(f.qr).toBeUndefined();
  });
  it("draws every field on a page", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const { drawTemplateFields } = await import("../lib/certificate-overlay");
    const pdf = await PDFDocument.create(), page = pdf.addPage([595.5, 842]);
    await drawTemplateFields(pdf, page, bundledLayout(file)!, { name: "Dela Cruz, Juan", startsOn: "2026-11-09", endsOn: "2026-11-09", issuedOn: "2026-11-09", certificateNumber: "NWMTACI-UBT-PSSR2026000001", registrationNumber: "NWMTC000001-112026", verifyUrl: null });
    expect((await pdf.save()).length).toBeGreaterThan(500);
  });
});

describe("duration labels in hours", () => {
  it("counts 8 hours a day", async () => {
    const { courseDays } = await import("../lib/scheduling");
    expect(courseDays("40 Hours")).toBe(5);
    expect(courseDays("8 hours")).toBe(1);
    expect(courseDays("3 days")).toBe(3);
    expect(courseDays("1.5 days")).toBe(2);
  });
});
