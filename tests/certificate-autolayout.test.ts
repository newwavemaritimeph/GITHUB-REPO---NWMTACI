import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from "pdf-lib";
import { autoLayout, dateSlots, layoutFromLines, readTemplateLines, type TemplateLine } from "../lib/certificate-autolayout";
import { drawTemplateFields, liftTemplateText, numberShift, type TemplateFieldsV2 } from "../lib/certificate-overlay";
import { templateLayout } from "../lib/certificate-template-layouts";
import { templateReadText } from "../components/portal/releasing-home";

const W = 595.3, H = 841.9;
const line = (text: string, x: number, right: number, y: number, size = 12, extra: Partial<TemplateLine> = {}): TemplateLine => ({ text, x, right, y, size, bold: false, sans: true, ...extra });

/** The PDF exported from the owner's Word file (no real certificate is kept in this public repository). */
const WORD: TemplateLine[] = [
  line("Certificate No: 094-609-000000", 344.7, 512.3, 675.7),
  line("Registration No: NWMTC22026-176", 344.7, 537.7, 660.7),
  line("Certificate of Training Completion", 88.8, 506.3, 601.9, 26, { bold: true }),
  line("This certificate is issued to", 227.2, 368, 555.2),
  line("TRAINEES NAME", 214.8, 380.4, 520, 20, { bold: true }),
  line("for having successfully completed the", 197.9, 397.3, 481.5),
  line("Resolution MSC.56 (108) of the Maritime Safety Committee", 56.6, 372.7, 357.3),
  line("conducted on May 25, 2026, as approved by the Maritime Industry Authority (MARINA)", 56.6, 538.1, 329.7),
  line("pursuant to Republic Act No. 10635, and in compliance with MARINA Memorandum", 56.6, 538.2, 315.9),
  line("Circulars No. SC-2022-05 and SC-2021-09, after having been assessed on May 25, 2026", 56.6, 538.3, 302.1),
  line("by the accredited Assessor based on the approved assessment methods and criteria.", 56.6, 508.7, 288.3),
  line("Issued this 25th day of May 2026 in the City of Manila, Philippines", 56.6, 406, 246.9),
  line("April Cantoneros", 69.6, 170, 178, 12, { bold: true }),
  line("Operational Manager", 63.4, 176, 164.2),
  line("President", 430, 468.1, 164.2),
];

describe("reading a certificate's details from an uploaded PDF", () => {
  it("finds every detail on the Word export, and lifts only the sample text", () => {
    const { fields: f, found, missing, lifted } = layoutFromLines(WORD, W, H);
    expect(missing).toEqual([]);
    expect(found).toEqual(["Trainee Name", "Training Dates", "Issued Date", "Certificate No.", "Registration No."]);
    expect(f?.auto).toBe(true);
    expect(f?.sans).toBe(true);
    expect(f?.name).toEqual({ cx: 297.6, y: 520, size: 20, bold: true, maxW: 482.1 });
    expect(f?.conducted?.text).toBe("conducted on [START DATE], as approved by the Maritime Industry Authority (MARINA) pursuant to Republic Act No. 10635, and in compliance with MARINA Memorandum Circulars No. SC-2022-05 and SC-2021-09, after having been assessed on [ASSESS DATE] by the accredited Assessor based on the approved assessment methods and criteria.");
    expect(f?.conducted).toMatchObject({ x: 56.6, y: 329.7, w: 481.7, leading: 13.8, align: 3 });
    expect(f?.issued).toEqual({ x: 56.6, y: 246.9, size: 12, text: "Issued this ______ day of ________________ 20____ in the City of Manila, Philippines" });
    expect(f?.certNo).toMatchObject({ x: 344.7, y: 675.7, label: "Certificate No:" });
    expect(f?.regNo).toMatchObject({ x: 344.7, y: 660.7, label: "Registration No:" });
    expect(lifted.map((l) => l.text)).not.toContain("This certificate is issued to");
    expect(lifted.map((l) => l.text)).not.toContain("Resolution MSC.56 (108) of the Maritime Safety Committee");
    expect(lifted.map((l) => l.text)).not.toContain("President");
    expect(f?.fixed).toEqual([{ text: "Operations Manager", cx: 119.7, y: 164.2, size: 12, bold: false }]);
  });

  it("reads both numbers from one line, keeping unrelated text beside them", () => {
    const { fields: f, found } = layoutFromLines([
      line("is issued to", 261, 334, 600), line("MARIA SANTOS", 200, 395, 560, 22, { bold: true }),
      line("Certificate No: A-1 Registration No: B-2", 60, 300, 120), line("Page 1", 500, 540, 120),
    ], W, H);
    expect(found).toEqual(expect.arrayContaining(["Certificate No.", "Registration No."]));
    expect(f?.certNo).toMatchObject({ x: 60, label: "Certificate No:" });
    expect(f?.regNo?.label).toBe("Registration No:");
    expect(f?.regNo?.x).toBeGreaterThan(60);
    const zones = f?.lift?.filter((z) => z.yMin < 120 && z.yMax > 120) ?? [];
    expect(zones.every((z) => (z.xMax ?? 0) < 500)).toBe(true);
  });

  it("takes a real sample name, and a bare label keeps its place with the value after it", () => {
    const { fields: f, lifted } = layoutFromLines([
      line("This is to certify that", 220, 370, 600), line("JUAN DELA CRUZ", 190, 400, 560, 24, { bold: true }),
      line("Certificate Number:", 57, 150, 200, 9), line("Registration Number: ____", 57, 170, 190, 9),
    ], W, H);
    expect(f?.name?.y).toBe(560);
    expect(f?.certNo?.x).toBe(152.7);
    expect(f?.certNo?.label).toBeUndefined();
    expect(lifted.map((l) => l.text)).not.toContain("Certificate Number:");
    expect(f?.regNo?.label).toBe("Registration Number:");
    expect(lifted.map((l) => l.text)).toContain("Registration Number: ____");
  });

  it("puts the name in the blank space when the design leaves it empty", () => {
    const { fields: f } = layoutFromLines([line("This certificate is issued to", 227, 368, 555), line("for having successfully completed the", 198, 397, 481)], W, H);
    expect(f?.name?.y).toBeGreaterThan(481);
    expect(f?.name?.y).toBeLessThan(555);
    expect(f?.name?.cx).toBe(297.5);
  });

  it("reports what it cannot find, and stores nothing without a name", () => {
    const read = layoutFromLines([line("New Wave Maritime", 100, 300, 700)], W, H);
    expect(read.fields).toBeNull();
    expect(read.missing).toEqual(["Trainee Name", "Training Dates", "Issued Date", "Certificate No.", "Registration No."]);
    expect(layoutFromLines([], W, H).fields).toBeNull();
  });

  it("still prints the numbers when the PDF has no line for them, and says so", () => {
    const read = layoutFromLines([line("TRAINEE NAME", 200, 400, 500, 20)], W, H);
    expect(read.missing).toEqual(expect.arrayContaining(["Certificate No.", "Registration No."]));
    expect(read.fields?.certNo?.label).toBe("Certificate No:");
    expect(read.fields?.regNo?.label).toBe("Registration No:");
  });

  it("keeps a paragraph whose first line is indented, and a word broken at a hyphen", () => {
    const { fields: f } = layoutFromLines([
      line("TRAINEE NAME", 200, 400, 600, 20),
      line("Conducted from ______ to ______ as approved by the Maritime", 71.1, 545.4, 430.8),
      line("Industry Authority, after having been assessed by the corrective-", 49.6, 545.4, 416.8),
      line("action Assessor on ______ in accordance with the methods.", 49.6, 400, 402.8),
    ], W, H);
    expect(f?.conducted).toMatchObject({ x: 49.6, y: 430.8, w: 495.8, align: 3 });
    expect(f?.conducted?.text).toBe("Conducted from [START DATE] to [END DATE] as approved by the Maritime Industry Authority, after having been assessed by the corrective-action Assessor on [ASSESS DATE] in accordance with the methods.");
  });

  it("turns sample dates and blanks into the placeholders the certificate fills", () => {
    expect(dateSlots("conducted on May 25, 2026, assessed on May 25, 2026").text).toBe("conducted on [START DATE], assessed on [ASSESS DATE]");
    expect(dateSlots("Conducted from May 25, 2026 to May 27, 2026").text).toBe("Conducted from [START DATE] to [END DATE]");
    expect(dateSlots("Conducted on November 9-11, 2026").text).toBe("Conducted on [START DATE] to [END DATE]");
    expect(dateSlots("Conducted on 25 May 2026").text).toBe("Conducted on [START DATE]");
    expect(dateSlots("Conducted on [DATE], with a total of 8 hours").text).toBe("Conducted on [DATE], with a total of 8 hours");
    expect(dateSlots("Conducted with no date").slots).toBe(0);
  });

  // Safety, Crowd and Crisis (owner, 5 Nov 2026): the Word files print "Issued this" and a bare "Date of Issue:" label.
  it("reads a (Training Date) sample and a sample date range with years", () => {
    expect(dateSlots("conducted on (Training Date), as approved, after having been assessed by the Assessor on (Training Date) in accordance").text).toBe("conducted on [START DATE], as approved, after having been assessed by the Assessor on [ASSESS DATE] in accordance");
    expect(dateSlots("conducted on May 25, 2026 to May 26, 2026, as approved, after having been assessed by the Assessor on May 26, 2026 in accordance").text).toBe("conducted on [START DATE] to [END DATE], as approved, after having been assessed by the Assessor on [ASSESS DATE] in accordance");
  });
  it("fills both the Issued line and the Date of Issue label when a page has both", () => {
    const { fields: f, found } = layoutFromLines([
      line("TRAINEES NAME", 214.8, 380.4, 581, 20, { bold: true }),
      line("conducted on (Training Date), as approved by MARINA.", 56.6, 400, 418),
      line("Issued this 25th day of May 2026 in the City of Manila, Philippines", 56.6, 405, 321),
      line("Certificate No:", 56.6, 134, 139),
      line("Registration No:", 56.6, 142, 125),
      line("Date of Issue:", 56.6, 130, 111),
    ], W, H);
    expect(f?.issued?.text).toBe("Issued this ______ day of ________________ 20____ in the City of Manila, Philippines");
    expect(f?.issueDate).toMatchObject({ y: 111, body: true });
    expect(f?.issueDate?.x).toBeGreaterThan(130);
    expect(f?.certNo?.x).toBeGreaterThan(134);
    expect(found.filter((x) => x === "Issued Date")).toHaveLength(1);
  });
  it("redraws a bare label too near the right edge, so a long number can move left (CCMD)", () => {
    const { fields: f, lifted } = layoutFromLines([
      line("TRAINEES NAME", 214.8, 380.4, 530, 20, { bold: true }),
      line("Certificate No:", 380, 460, 699),
      line("Registration No:", 380, 468, 685),
    ], W, H);
    expect(f?.certNo).toMatchObject({ x: 380, label: "Certificate No:" });
    expect(f?.regNo).toMatchObject({ x: 380, label: "Registration No:" });
    expect(lifted.map((l) => l.text)).toEqual(expect.arrayContaining(["Certificate No:", "Registration No:"]));
  });
  it("moves number lines left only as far as the widest needs, and not at all when they fit", () => {
    expect(numberShift([{ x: 57, width: 200 }, { x: 57, width: 215 }], W)).toBe(0);
    expect(numberShift([{ x: 380, width: 170 }, { x: 380, width: 215 }], 595)).toBe(36);
  });
});

describe("removing sample text", () => {
  async function pageWith(content: string) {
    const doc = await PDFDocument.create(), page = doc.addPage([612, 792]);
    page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(content)));
    return { doc, page, left: () => new TextDecoder("latin1").decode(decodePDFRawStream(doc.context.lookup(page.node.get(PDFName.of("Contents"))) as PDFRawStream).decode()) };
  }

  it("follows the page's scale and text moves, as PDFs from other programs write them", async () => {
    const { doc, page, left } = await pageWith("q .75 0 0 -.75 0 792 cm BT /F1 16 Tf 1 0 0 -1 100 200 Tm (Hello) Tj 0 -20 Td (World) Tj ET Q");
    expect(liftTemplateText(doc, page, [{ yMin: 640, yMax: 644 }])).toBe(1);
    expect(left()).not.toContain("(Hello)");
    expect(left()).toContain("(World)");
  });

  it("removes a whole array of text, and leaves other columns on the same line", async () => {
    const { doc, page, left } = await pageWith("BT /F1 12 Tf 1 0 0 1 60 500 Tm [(Sam)3(ple)] TJ ET BT /F1 12 Tf 1 0 0 1 400 500 Tm (Keep) Tj ET");
    expect(liftTemplateText(doc, page, [{ yMin: 498, yMax: 505, xMin: 59, xMax: 300 }])).toBe(1);
    expect(left()).not.toContain("Sam");
    expect(left()).toContain("(Keep)");
  });
});

describe("an uploaded PDF from start to finish", () => {
  async function sample(extra: (page: ReturnType<PDFDocument["addPage"]>, font: Awaited<ReturnType<PDFDocument["embedFont"]>>) => void = () => {}) {
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), page = doc.addPage([595, 842]);
    page.drawText("This certificate is issued to", { x: 220, y: 600, size: 12, font });
    page.drawText("TRAINEES NAME", { x: 215, y: 560, size: 20, font: bold });
    page.drawText("conducted on May 25, 2026 in Manila", { x: 60, y: 400, size: 12, font });
    page.drawText("Issued this 25th day of May 2026 in the City of Manila", { x: 60, y: 300, size: 12, font });
    page.drawText("Certificate No: 094-609-000000", { x: 60, y: 200, size: 10, font });
    page.drawText("Registration No: NWMTC22026-176", { x: 60, y: 185, size: 10, font });
    extra(page, font);
    return doc.save();
  }

  it("reads it, takes the sample off, and fills in the real details with nothing printed twice", async () => {
    const bytes = await sample();
    const read = await autoLayout(bytes, { hasMeasuredLayout: false });
    expect(read?.missing).toEqual([]);
    expect(read?.covered).toBeUndefined();
    const fields = read!.fields as TemplateFieldsV2;
    expect(fields.sans).toBe(true);
    expect(fields.name?.bold).toBe(true);

    const src = await PDFDocument.load(bytes), out = await PDFDocument.create();
    liftTemplateText(src, src.getPage(0), fields.lift!);
    const [copied] = await out.copyPages(src, [0]);
    const page = out.addPage(copied);
    await drawTemplateFields(out, page, fields, { name: "Juan Dela Cruz", startsOn: "2026-11-09", endsOn: "2026-11-09", issuedOn: "2026-11-05", certificateNumber: "094-609-000123", registrationNumber: "NWMTC112026-177" });
    const text = (await readTemplateLines(await out.save())).lines.map((l) => l.text).join("\n");
    expect(text).toContain("JUAN DELA CRUZ");
    expect(text).toContain("conducted on November 9, 2026 in Manila");
    expect(text).toContain("Issued this 5th day of November 2026 in the City of Manila");
    expect(text).toContain("Certificate No: 094-609-000123");
    expect(text).toContain("Registration No: NWMTC112026-177");
    for (const old of ["TRAINEES NAME", "May 25", "25th", "094-609-000000", "NWMTC22026"]) expect(text).not.toContain(old);
    expect(text).toContain("This certificate is issued to");
  });

  it("covers sample text it cannot take off", async () => {
    // Text inside a nested drawing is out of reach of the remover; the check after lifting catches it.
    const inner = await PDFDocument.create(), font = await inner.embedFont(StandardFonts.Helvetica);
    inner.addPage([595, 842]).drawText("TRAINEES NAME", { x: 215, y: 560, size: 20, font });
    const fresh = await PDFDocument.create(), [picture] = await fresh.embedPdf(await inner.save());
    fresh.addPage([595, 842]).drawPage(picture, { x: 0, y: 0 });
    const read = await autoLayout(await fresh.save(), { hasMeasuredLayout: false });
    expect(read?.covered).toBe(true);
    expect(read?.fields?.cover?.[0]).toMatchObject({ x: 214 });
  });

  it("leaves a file converted from the Word templates to its measured positions", async () => {
    const bytes = await sample((page, font) => page.drawText("[TRAINEE FULL NAME]", { x: 200, y: 700, size: 12, font }));
    expect(await autoLayout(bytes, { hasMeasuredLayout: true })).toBeNull();
    expect((await autoLayout(bytes, { hasMeasuredLayout: false }))?.fields).not.toBeNull();
  });

  it("keeps the measured positions when the page hides its dates paragraph, and reads a new design under an old name", async () => {
    // The 141 In-House PDFs: the name, description and dates stay invisible until print, so a read finds no dates paragraph.
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), page = doc.addPage([595, 842]);
    page.drawText("is issued to", { x: 260, y: 607, size: 12, font });
    page.drawText("for having successfully completed the", { x: 200, y: 533, size: 12, font });
    page.drawText("Certificate Number:", { x: 56, y: 235, size: 9, font });
    const converted = await doc.save();
    expect(await autoLayout(converted, { hasMeasuredLayout: true })).toBeNull();
    expect((await autoLayout(converted, { hasMeasuredLayout: false }))?.missing).toContain("Training Dates");
    expect(await autoLayout(await sample(), { hasMeasuredLayout: true })).not.toBeNull();
  });
});

describe("which positions a template prints with", () => {
  const stored = { version: 2, name: { cx: 1, y: 1, size: 1, maxW: 1 } };
  const read = { ...stored, auto: true };
  const bundled = "course/00000000-0000-0000-0000-000000000000-ABC---Awareness-on-Basic-Computer.pdf";

  it("uses what was read from the file first, so a new design under an old name is never stale", () => {
    expect(templateLayout({ storagePath: bundled, fields: read, code: "ABC", isPdf: true })).toBe(read);
  });
  it("then the measured fixes, then the upload's, then the course's", () => {
    expect(templateLayout({ storagePath: bundled, fields: stored, code: "ABC", isPdf: true })?.name?.y).toBe(563.8);
    expect(templateLayout({ storagePath: "course/00000000-0000-0000-0000-000000000000-new.pdf", fields: stored, code: "ABC", isPdf: true })).toBe(stored);
    expect(templateLayout({ storagePath: "course/00000000-0000-0000-0000-000000000000-new.pdf", fields: [], code: "UBT-PSSR", isPdf: true })?.lift?.length).toBe(5);
    expect(templateLayout({ storagePath: "course/00000000-0000-0000-0000-000000000000-new.png", fields: [], code: "UBT-PSSR", isPdf: false })).toBeNull();
  });
});

describe("what the upload says", () => {
  it("lists what was found and what to check", () => {
    expect(templateReadText({ found: ["Trainee Name"], missing: [] })).toBe("Found: Trainee Name.");
    expect(templateReadText({ found: ["Trainee Name"], missing: ["Photo Box"] })).toBe("Found: Trainee Name. Not Found: Photo Box. Open View to check.");
    expect(templateReadText({ found: [], missing: [], covered: true })).toContain("white boxes");
    expect(templateReadText(null)).toBe("");
  });
});
