import { describe, expect, it } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import { detectPhotoBox, pickPhotoBox } from "@/lib/certificate-template";

const A4_LANDSCAPE: [number, number] = [842, 595];

describe("2x2 photo box detection", () => {
  it("finds a drawn 2x2 box and ignores a smaller logo box", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage(A4_LANDSCAPE);
    page.drawRectangle({ x: 381, y: 470, width: 80, height: 80, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    page.drawRectangle({ x: 640, y: 60, width: 144, height: 144, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    const box = await detectPhotoBox(await pdf.save());
    expect(box).toMatchObject({ x: 640, y: 60, w: 144, h: 144, source: "box" });
  });

  it("finds a box made of four separate border lines", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage(A4_LANDSCAPE);
    const [x, y, s] = [80, 70, 150];
    page.drawLine({ start: { x, y }, end: { x: x + s, y } });
    page.drawLine({ start: { x, y: y + s }, end: { x: x + s, y: y + s } });
    page.drawLine({ start: { x, y }, end: { x, y: y + s } });
    page.drawLine({ start: { x: x + s, y }, end: { x: x + s, y: y + s } });
    const box = await detectPhotoBox(await pdf.save());
    expect(box?.source).toBe("lines");
    expect(box?.x).toBeCloseTo(80, 0);
    expect(box?.w).toBeCloseTo(150, 0);
  });

  it("follows nested drawings and their scaling", async () => {
    const src = await PDFDocument.create();
    src.addPage([600, 400]).drawRectangle({ x: 100, y: 50, width: 288, height: 288, borderColor: rgb(0, 0, 0), borderWidth: 1 });
    const pdf = await PDFDocument.create();
    const embedded = await pdf.embedPage(src.getPage(0));
    pdf.addPage(A4_LANDSCAPE).drawPage(embedded, { x: 20, y: 30, xScale: 0.5, yScale: 0.5 });
    const box = await detectPhotoBox(await pdf.save());
    expect(box?.x).toBeCloseTo(70, 0);
    expect(box?.y).toBeCloseTo(55, 0);
    expect(box?.w).toBeCloseTo(144, 0);
  });

  it("returns null when there is no box", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage(A4_LANDSCAPE).drawText("Certificate of Completion", { x: 300, y: 400 });
    expect(await detectPhotoBox(await pdf.save())).toBeNull();
  });

  it("prefers square boxes near 2 inches over wide frames and pictures", () => {
    const pick = pickPhotoBox([
      { x: 0, y: 0, w: 250, h: 100, source: "box" },
      { x: 10, y: 10, w: 140, h: 140, source: "picture" },
      { x: 600, y: 50, w: 150, h: 150, source: "box" },
    ], 842, 595);
    expect(pick).toMatchObject({ x: 600, source: "box" });
  });
});
