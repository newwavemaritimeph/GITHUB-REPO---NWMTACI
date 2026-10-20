import { describe, expect, it } from "vitest";
import { CROCKFORD, formatVerifyCode, newVerifyCode, normalizeVerifyCode, verifyUrl } from "../lib/certificate-verify";
import { conductedText, issuedText } from "../lib/certificate-overlay";
import { certificateState, courseRemoveMode, evaluationRequiredFor, releaseProblem } from "../lib/certificate-rules";
import { summarizeCertificateDay } from "../lib/certificate-report";

describe("verify codes", () => {
  it("are 12 random Crockford characters without I, L, O or U", () => {
    const codes = new Set(Array.from({ length: 200 }, () => newVerifyCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) { expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/); for (const ch of c) expect(CROCKFORD).toContain(ch); }
  });
  it("normalise what a person types and format the QR link", () => {
    expect(normalizeVerifyCode("8kx4-q2pm-7tzd")).toBe("8KX4Q2PM7TZD");
    expect(normalizeVerifyCode("8KX4 Q2PM 7TZO")).toBe("8KX4Q2PM7TZ0");
    expect(normalizeVerifyCode("8KX4-Q2PM-7TZ")).toBeNull();
    expect(formatVerifyCode("8KX4Q2PM7TZD")).toBe("8KX4-Q2PM-7TZD");
    expect(verifyUrl("8KX4Q2PM7TZD")).toBe("https://newwavemaritimemtaci.com/verify/8KX4-Q2PM-7TZD");
  });
});

describe("Word template overlay text", () => {
  it("fills one-day and multi-day dates", () => {
    expect(conductedText("Conducted on [DATE], with a total of 8 hours.", "2026-10-19", "2026-10-19")).toBe("Conducted on October 19, 2026, with a total of 8 hours.");
    expect(conductedText("Conducted from [START DATE] to [END DATE], with", "2026-10-12", "2026-10-16")).toBe("Conducted from October 12, 2026 to October 16, 2026, with");
  });
  it("fills the issued line with an ordinal day", () => {
    expect(issuedText("Issued this ______ day of ________________ 20____ in the City of Manila, Philippines.", "2026-10-22")).toBe("Issued this 22nd day of October 2026 in the City of Manila, Philippines.");
  });
});

describe("evaluation, release and revoke rules", () => {
  it("needs the evaluation for New Wave courses only", () => {
    expect(evaluationRequiredFor("In-House", null)).toBe(true);
    expect(evaluationRequiredFor("In-House", "offer-1")).toBe(false);
    expect(evaluationRequiredFor("Partner or Endorsed", null)).toBe(false);
  });
  it("releases only when paid and evaluated", () => {
    expect(releaseProblem({ balanceCentavos: 100, evaluationRequired: true, evaluationOn: "2026-10-20" })).toMatch(/Not paid/);
    expect(releaseProblem({ balanceCentavos: 0, evaluationRequired: true, evaluationOn: null })).toMatch(/Evaluation/);
    expect(releaseProblem({ balanceCentavos: 0, evaluationRequired: true, evaluationOn: "2026-10-20" })).toBeNull();
    expect(releaseProblem({ balanceCentavos: 0, evaluationRequired: false, evaluationOn: null, revoked: true })).toMatch(/revoked/);
  });
  it("a revoked certificate never prints again", () => {
    const v = certificateState({ enrollmentStatus: "Enrolled", trainingEnd: "2026-10-10", balanceCentavos: 0, evaluationRequired: false, evaluationOn: null, paidOn: "2026-10-01", cert: { status: "Printed", printCount: 1, reprintsAllowed: 1, revoked: true } }, "2026-10-20");
    expect(v.state).toBe("Revoked");
    expect(v.printsLeft).toBe(0);
  });
  it("deletes an unused course and archives a used one", () => {
    expect(courseRemoveMode(0)).toBe("delete");
    expect(courseRemoveMode(3)).toBe("archive");
  });
});

describe("8:00 PM certificate report", () => {
  it("counts prints, reprints, exceptions and shared QR scans", () => {
    const s = summarizeCertificateDay({
      prints: [
        { certNo: "HPT-00150", by: "Karen", at: "2026-10-20T02:00:00Z", print: 1, balanceCentavos: 0 },
        { certNo: "ABC-00042", by: "Karen", at: "2026-10-20T11:30:00Z", print: 2, balanceCentavos: 0 }, // 7:30 PM Manila
        { certNo: "SSO-00010", by: "April", at: "2026-10-20T03:00:00Z", print: 1, balanceCentavos: 5000 },
      ],
      revokes: [{ certNo: "ECDIS-00150", by: "Admin", reason: "Issued in error" }],
      directSql: 1,
      scans: [{ certNo: "HPT-00131", result: "valid", ipHash: "a" }, { certNo: "HPT-00131", result: "valid", ipHash: "b" }, { certNo: "HPT-00131", result: "valid", ipHash: "c" }, { certNo: null, result: "not_found", ipHash: "d" }],
    });
    expect([s.printed, s.reprinted, s.revoked]).toEqual([2, 1, 1]);
    expect(s.unpaid).toEqual(["SSO-00010"]);
    expect(s.afterHours).toHaveLength(1);
    expect(s.directSql).toBe(1);
    expect([s.scans, s.notFound]).toEqual([4, 1]);
    expect(s.spread).toEqual([{ certNo: "HPT-00131", devices: 3 }]);
  });
});

describe("bundled template positions", () => {
  it("find the converted template's fields from its stored file name", async () => {
    const { bundledLayout } = await import("../lib/certificate-template-layouts");
    const f = bundledLayout("course-id/0b6f2a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b-ABC---Awareness-on-Basic-Computer.pdf");
    expect(f?.version).toBe(2);
    expect(f?.conducted?.text).toContain("Conducted on [DATE]");
    expect(bundledLayout("course-id/0b6f2a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b-some-other-design.pdf")).toBeNull();
    expect(bundledLayout(null)).toBeNull();
  });
});

describe("template view", () => {
  it("draws the description with blank dates and no numbers", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const { drawTemplateFields } = await import("../lib/certificate-overlay");
    const { bundledLayout } = await import("../lib/certificate-template-layouts");
    const fields = bundledLayout("c/0b6f2a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b-ABC---Awareness-on-Basic-Computer.pdf")!;
    const pdf = await PDFDocument.create(), page = pdf.addPage([595.32, 841.92]);
    const drawn: string[] = [];
    const orig = page.drawText.bind(page);
    page.drawText = ((t: string, o?: Parameters<typeof orig>[1]) => { drawn.push(t); return orig(t, o); }) as typeof page.drawText;
    await drawTemplateFields(pdf, page, fields, { name: "", startsOn: null, endsOn: null, issuedOn: "", certificateNumber: "ABC-00042", registrationNumber: "NWMTC1", verifyUrl: null, blank: true });
    const all = drawn.join(" ");
    expect(all).toContain("TRAINEE NAME");
    expect(all).toContain("________________");
    expect(all).toContain("Issued this ______ day");
    expect(all).not.toContain("ABC-00042");
  });
});
