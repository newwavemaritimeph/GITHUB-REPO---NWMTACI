import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { drawTemplateFields } from "@/lib/certificate-overlay";

const fill = { name: "Juan Dela Cruz", startsOn: "2026-11-03", endsOn: "2026-11-05", issuedOn: "2026-11-06", certificateNumber: "NWM-1", registrationNumber: "REG-1" };
const box = { x: 42.5, y: 26.8, w: 53.8, h: 65.5 };

async function pageWith(fields: Parameters<typeof drawTemplateFields>[2], extra = {}) {
  const pdf = await PDFDocument.create(), page = pdf.addPage([595, 842]);
  await drawTemplateFields(pdf, page, fields, { ...fill, ...extra });
  const bytes = Buffer.from(await pdf.save({ useObjectStreams: false })).toString("latin1");
  return { hasImage: /\/Subtype\s*\/Image/.test(bytes), helvetica: bytes.includes("Helvetica-Bold") };
}

describe("No QR on the certificate (owner, 6 Nov 2026)", () => {
  it("prints no QR picture and no SCAN TO VERIFY caption", async () => {
    const printed = await pageWith({ version: 2, qr: box });
    expect(printed.hasImage).toBe(false);
    expect(printed.helvetica).toBe(false);
  });
  it("covers the template's placeholder on a print and on the template view", async () => {
    for (const extra of [{}, { blank: true }]) {
      const pdf = await PDFDocument.create(), page = pdf.addPage([595, 842]);
      const covers: unknown[] = [];
      const draw = page.drawRectangle.bind(page);
      page.drawRectangle = (o) => { covers.push(o); draw(o!); };
      await drawTemplateFields(pdf, page, { version: 2, qr: box }, { ...fill, ...extra });
      expect(covers).toEqual([expect.objectContaining({ x: box.x - 1.5, y: box.y - 1.5, width: box.w + 3, height: box.h + 3 })]);
    }
  });
  it("draws nothing there for a template without the box, so MARINA's QR on the STCW templates stays", async () => {
    const pdf = await PDFDocument.create(), page = pdf.addPage([595, 842]);
    const covers: unknown[] = [];
    const draw = page.drawRectangle.bind(page);
    page.drawRectangle = (o) => { covers.push(o); draw(o!); };
    await drawTemplateFields(pdf, page, { version: 2 }, fill);
    expect(covers).toEqual([]);
  });
});

describe("Course names script, 6 Nov 2026", () => {
  const sql = readFileSync("supabase/scripts/fix_templates_and_course_names_2026_11.sql", "utf8");
  it("corrects ISM, which the official list had as FRAMO Pump", () => {
    expect(sql).toContain("('ISM', 'International Safety Management (ISM) Code')");
    expect(sql).not.toContain("('ISM', 'FRAMO Pump')");
    expect(readFileSync("lib/in-house-catalog.ts", "utf8")).toContain("ISM|International Safety Management (ISM) Code|");
  });
  it("leaves the full STCW titles and every duration alone", () => {
    for (const code of ["UBT-PSSR", "PSCMT", "PSCMHBT", "BRM-BTM", "CCMI"]) expect(sql).not.toContain(`('${code}', `);
    expect(sql).not.toMatch(/duration_label\s*=/);
  });
  it("puts back the 3-Day MARPOL and the HACCP templates", () => {
    expect(sql).toContain("t.storage_path like '%MARPOL-3DAY---%'");
    expect(sql).toContain("t.storage_path like '%Hazard-Analysis-and-Critical-Control-Points%'");
  });
});
