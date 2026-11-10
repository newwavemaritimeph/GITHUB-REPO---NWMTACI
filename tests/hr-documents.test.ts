import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildHrDocumentPdf, dayOf, fillTemplate, longDate } from "@/lib/print/hr-documents";

describe("HR documents", () => {
  it("fills known fields and leaves unknown ones visible", () => {
    expect(fillTemplate("Hi {{title}} {{ employee_name }}, {{nope}}.", { title: "Ms.", employee_name: "SAMPLE" })).toBe("Hi Ms. SAMPLE, {{nope}}.");
  });
  it("writes the issue date the way a COE reads", () => {
    expect(longDate("2026-11-10")).toBe("November 10, 2026");
    expect(dayOf("2026-11-01")).toBe("1st day of November 2026");
    expect(dayOf("2026-11-12")).toBe("12th day of November 2026");
    expect(dayOf("2026-11-23")).toBe("23rd day of November 2026");
  });
  it("prints the COE on A4 and the memo on Legal", async () => {
    const coe = await PDFDocument.load(await buildHrDocumentPdf({ type: "coe", number: "NWM-COE-2026-0001", templateVersion: 1, body: "This is to certify.", signatories: [{ label: "Certified by", name: "SAMPLE", title: "General Manager" }] }, null));
    expect(coe.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
    const memo = await PDFDocument.load(await buildHrDocumentPdf({ type: "memo", number: "NWM-MEMO-2026-001", templateVersion: 1, body: "Body.", signatories: [{ label: "", name: "ADMIN", title: "Admin" }], rows: [["To", "All Employees"]] }, null));
    expect(memo.getPage(0).getSize()).toEqual({ width: 612, height: 1008 });
  });
});
