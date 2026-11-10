import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createReferralVoucherPdf } from "@/lib/print/referral-voucher";
import { createServiceInvoicePdf } from "@/lib/print/service-invoice";

// Corporate Two-Tone letterhead and footer on legal paper (owner, 10 Nov 2026).
async function textOf(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((t) => ("str" in t ? t.str : "")).join(" "));
  return pages;
}
const ctl = { formNo: "NW-FMGR-02-24", revisionNo: "001", revisionDate: "11/10/2026", issuedDate: "12/03/2024" };
const logo = new Uint8Array(readFileSync("public/new-wave-emblem.png"));

describe("the shared letterhead and footer", () => {
  it("puts every page on legal paper with the form details, the signatories, Page x of y and the tagline", async () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ enrolledOn: "2026-11-02", trainee: `SAMPLE ${i}`, courseCode: "UBT-PSSR", course: "Basic Training", rebateCentavos: 50000 }));
    const bytes = await createReferralVoucherPdf({ number: "RV-2026-000001", issuedOn: "2026-11-10", partner: "Sample", kind: "Agency", referralCode: null, contact: null, from: "2026-11-01", to: "2026-11-10", rows, totalCentavos: 3000000, preparedBy: "Sample" }, logo, ctl);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    for (const p of doc.getPages()) expect([p.getWidth(), p.getHeight()]).toEqual([612, 1008]);
    const [one, two] = await textOf(bytes);
    for (const t of ["NW-FMGR-02-24", "Controlled by:", "VAM", "Approved by:", "MAAV", "Issued to:", "Page 1 of 2", "Ride the New Wave of Maritime Excellence"]) expect(one).toContain(t);
    expect(two).toContain("Page 2 of 2");
    expect(two).toContain("(continued)");
  });
  it("keeps the Service Invoice Control No. on the legal letterhead", async () => {
    const bytes = await createServiceInvoicePdf("SI-2026-000001", { billTo: "Sample", paidOn: "Nov 5, 2026", bsNumber: "1", method: "Cash", reference: "", coverage: "Oct", rows: [{ name: "A", training: "B", amount: 1 }], total: 1, words: "One centavo", control: { controlNo: "0001", ...ctl } } as never, logo);
    const [page] = await textOf(bytes);
    expect(page).toContain("Control No.".toUpperCase());
    expect(page).toContain("SERVICE INVOICE");
    expect((await PDFDocument.load(bytes)).getPage(0).getSize()).toEqual({ width: 612, height: 1008 });
  });
});
