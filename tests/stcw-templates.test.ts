import { describe, expect, it } from "vitest";
import type { PDFRawStream } from "pdf-lib";
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
  it("has the layout of the owner's Word file: dates, issued line, numbers at the top right, photo, no QR", () => {
    const f = bundledLayout(file)!;
    expect(f.conducted?.text).toContain("[START DATE]");
    expect(f.conducted?.text).toContain("[ASSESS DATE]");
    expect(f.issued?.x).toBe(56.6);
    expect(f.certNo!.y).toBeGreaterThan(600);
    expect(f.regNo!.y).toBeLessThan(f.certNo!.y);
    expect(f.sans).toBe(true);
    expect(f.photo).toBeTruthy();
    expect(f.qr).toBeUndefined();
  });
  it("uses the owner's own PDF as it is: the sample text comes off and the title is printed", async () => {
    const { PDFDocument, PDFName, decodePDFRawStream, StandardFonts } = await import("pdf-lib");
    const { liftTemplateText } = await import("../lib/certificate-overlay");
    for (const name of ["UBT-PSSR--TEMPLATE-.pdf", "NWMTACI-COC---UBT-PSSR.pdf"]) {
      const f = bundledLayout(`course/00000000-0000-0000-0000-000000000000-${name}`)!;
      expect(f.lift?.length).toBe(4);
      expect(f.fixed?.map((w) => w.text)).toContain("Operations Manager");
    }
    const f = bundledLayout("course/00000000-0000-0000-0000-000000000000-UBT-PSSR--TEMPLATE-.pdf")!;
    const made = await PDFDocument.create(), font = await made.embedFont(StandardFonts.Helvetica), blank = made.addPage([595.5, 842]);
    for (const [text, x, y] of [["TRAINEES NAME", 200, 540], ["Keep me", 200, 622], ["conducted on May 25", 56, 350], ["Issued this 25th", 56, 267], ["Operational Manager", 60, 184], ["President", 400, 184]] as const) blank.drawText(text, { x, y, size: 12, font });
    const doc = await PDFDocument.load(await made.save()), page = doc.getPages()[0];
    expect(liftTemplateText(doc, page, f.lift!)).toBe(4);
    const stream = doc.context.lookup(page.node.get(PDFName.of("Contents")));
    const left = new TextDecoder("latin1").decode(decodePDFRawStream(stream as PDFRawStream).decode());
    expect((left.match(/BT\s/g) ?? []).length).toBe(2);
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
