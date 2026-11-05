import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TarSheets, type TarCourse, type TarProps } from "@/app/portal/admission-record/[id]/tar-sheets";

const course = (i: number): TarCourse => ({ id: String(i), code: `C${i}`, name: `Course ${i}`, dates: "Nov 10", time: "8:00", room: "Room 1", fee: 100000 });
const props = (courses: number): TarProps => ({
  arNumber: "TAR-2026-000001", issued: "Nov 5, 2026", name: "DELA CRUZ, Juan P.",
  trainee: { appNo: "NWMTACI-0000001", srn: null, rank: null, mobile: null, company: null },
  courses: Array.from({ length: courses }, (_, i) => course(i)), misc: [], discounts: [], payments: [],
  feesTotal: 0, due: 0, paid: 0, balance: 0, status: "UNPAID", officer: "", cashier: "",
});
const render = (courses: number) => renderToStaticMarkup(createElement(TarSheets, props(courses)));
const sheets = (html: string) => html.split('<section class="tar-legal">').slice(1);

describe("Terms and Conditions on the back of the TAR", () => {
  it("prints right after page 1, one copy behind each cut front", () => {
    const [front, back, extra] = sheets(render(1));
    expect(front).toContain("TRAINING ADMISSION RECORD");
    expect(back.match(/TERMS AND CONDITIONS</g)).toHaveLength(2);
    expect(back).toContain("ORIGINAL COPY");
    expect(back).toContain("DUPLICATE COPY");
    expect(extra).toBeUndefined();
  });
  it("keeps page 2 of a long TAR after the back of page 1", () => {
    const [front, back, second] = sheets(render(7));
    expect(front).toContain("on page 2");
    expect(back).toContain("No Refund Policy");
    expect(second).toContain("Continuation of TAR-2026-000001");
  });
  it("carries all eight sections and drops the old refund and cancellation wording", () => {
    const html = render(1);
    for (const title of ["Payment Terms", "No Refund Policy", "Rescheduling", "Cancellation", "Training in Progress", "Partial Payments", "Make-Up Class Policy", "Issuance of Certificate of Completion"]) expect(html).toContain(title);
    expect(html).not.toContain("Refund Policy of");
    expect(html).not.toContain("Deductions follow");
    expect(html).not.toContain("SUMMARY");
  });
  it("leaves only a pointer to the terms on the front", () => {
    const [front] = sheets(render(1));
    expect(front).toContain("TERMS AND CONDITIONS AT THE BACK");
    expect(front).not.toContain("Refund");
  });
  it("puts the signing statement above the signature lines, on both front copies", () => {
    const [front, back] = sheets(render(1));
    expect(front.match(/By signing below, I hereby acknowledge/g)).toHaveLength(2);
    expect(front.indexOf("By signing below")).toBeLessThan(front.indexOf("Registration officer"));
    expect(back).not.toContain("By signing below");
  });
  it("tells staff to print on both sides", () => {
    expect(render(1)).toContain("on both sides, flip on long edge");
  });
});
