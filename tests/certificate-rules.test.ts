import { describe, expect, it } from "vitest";
import { canPrint, certificateStage, certificateState, driveFileId, formatCertificateNumber, googleFormId, matchEvaluationEnrollment, noPaymentYet, releaseProblem, type CertificateFacts } from "../lib/certificate-rules";

const base: CertificateFacts = { enrollmentStatus: "Enrolled", trainingEnd: "2026-10-07", balanceCentavos: 0, paidCentavos: 130000, evaluationRequired: false, evaluationOn: null, paidOn: "2026-10-05", cert: null };

describe("certificate rules", () => {
  it("waits for the training to end", () => {
    expect(certificateState({ ...base, trainingEnd: "2026-10-09" }, "2026-10-08").state).toBe("Training not finished");
    expect(certificateState({ ...base, trainingEnd: null }, "2026-10-08").state).toBe("Training not finished");
  });
  it("blocks everything until a payment is recorded, even during training", () => {
    const unpaid = { ...base, balanceCentavos: 130000, paidCentavos: 0 };
    const v = certificateState(unpaid, "2026-10-08");
    expect(v.state).toBe("Waiting for payment");
    expect(canPrint(v)).toBe(false);
    expect(certificateState({ ...unpaid, trainingEnd: "2026-10-30" }, "2026-10-08").state).toBe("Waiting for payment");
  });
  it("prints on an initial payment, and still needs the evaluation and the photo", () => {
    const initial = { ...base, balanceCentavos: 65000, paidCentavos: 65000 };
    const v = certificateState(initial, "2026-10-08");
    expect(v.state).toBe("Due");
    expect(canPrint(v)).toBe(true);
    expect(certificateState({ ...initial, evaluationRequired: true }, "2026-10-08").state).toBe("Waiting for evaluation");
    expect(certificateState({ ...initial, photoOnFile: false }, "2026-10-08").state).toBe("Waiting for photo");
  });
  it("prints a Company Charge with no payment recorded", () => {
    const billed = { ...base, balanceCentavos: 0, paidCentavos: 0, paidOn: null };
    expect(noPaymentYet(billed)).toBe(false);
    expect(canPrint(certificateState(billed, "2026-10-08"))).toBe(true);
  });
  it("allows no reprint once the only payment is voided", () => {
    const v = certificateState({ ...base, balanceCentavos: 130000, paidCentavos: 0, cert: { status: "Printed", printCount: 1, reprintsAllowed: 1 } }, "2026-10-08");
    expect(v.state).toBe("Waiting for payment");
    expect(canPrint(v)).toBe(false);
  });
  it("releases only when the balance is settled", () => {
    expect(releaseProblem({ balanceCentavos: 65000, evaluationRequired: false, evaluationOn: null })).toMatch(/^Not paid/);
    expect(releaseProblem({ balanceCentavos: 0, evaluationRequired: false, evaluationOn: null })).toBeNull();
  });
  it("puts each certificate on one Stage Tab, and moves it once printed", () => {
    const stage = (f: Partial<CertificateFacts>) => certificateStage(certificateState({ ...base, ...f }, "2026-10-08"));
    expect(stage({ trainingEnd: "2026-10-30" })).toBe("Waiting");
    expect(stage({ evaluationRequired: true })).toBe("Waiting");
    expect(stage({})).toBe("To Print");
    expect(stage({ cert: { status: "Printed", printCount: 1, reprintsAllowed: 0 } })).toBe("To Release");
    expect(stage({ cert: { status: "Printed", printCount: 1, reprintsAllowed: 1 } })).toBe("To Print");
    expect(stage({ cert: { status: "Printed", printCount: 1, reprintsAllowed: 0, voidStatus: "Requested" } })).toBe("To Release");
    expect(stage({ cert: { status: "Released", printCount: 1, reprintsAllowed: 0 } })).toBe("Released");
    expect(stage({ cert: { status: "Printed", printCount: 1, reprintsAllowed: 0, revoked: true } })).toBeNull();
  });
  it("needs the evaluation only when the course has a form", () => {
    expect(certificateState({ ...base, evaluationRequired: true }, "2026-10-08").state).toBe("Waiting for evaluation");
    expect(certificateState({ ...base, evaluationRequired: false }, "2026-10-08").state).toBe("Due");
    expect(certificateState({ ...base, evaluationRequired: true, evaluationOn: "2026-10-08" }, "2026-10-08").state).toBe("Due");
  });
  it("is overdue after its due day", () => {
    expect(certificateState({ ...base, trainingEnd: "2026-10-08", paidOn: "2026-10-01" }, "2026-10-08").overdue).toBe(false);
    const v = certificateState(base, "2026-10-08");
    expect(v.dueOn).toBe("2026-10-07");
    expect(v.overdue).toBe(true);
    // Due day is the latest of training end, payment and evaluation.
    expect(certificateState({ ...base, evaluationRequired: true, evaluationOn: "2026-10-08" }, "2026-10-08").overdue).toBe(false);
  });
  it("prints once, then only with an approved reprint", () => {
    const printed = certificateState({ ...base, cert: { status: "Printed", printCount: 1, reprintsAllowed: 0 } }, "2026-10-08");
    expect(printed.state).toBe("Printed");
    expect(canPrint(printed)).toBe(false);
    const reprint = certificateState({ ...base, cert: { status: "Printed", printCount: 1, reprintsAllowed: 1 } }, "2026-10-08");
    expect(canPrint(reprint)).toBe(true);
    expect(reprint.printsLeft).toBe(1);
    expect(certificateState({ ...base, cert: { status: "Printed", printCount: 1, reprintsAllowed: 0, voidStatus: "Requested" } }, "2026-10-08").state).toBe("Void requested");
  });
  it("formats numbers and reads links", () => {
    expect(formatCertificateNumber("NWM-BT-", 1245, 5)).toBe("NWM-BT-01245");
    expect(formatCertificateNumber("", 7, 3)).toBe("007");
    // In-House (owner, 3 Nov 2026): NWMTACI-<year>-<code>-000001, the year filled in.
    expect(formatCertificateNumber("NWMTACI-{YYYY}-HPT-", 1, 6, 2026)).toBe("NWMTACI-2026-HPT-000001");
    expect(formatCertificateNumber("NWMTACI-{YYYY}-HPT-", 1, 6, 2027)).toBe("NWMTACI-2027-HPT-000001");
    expect(formatCertificateNumber("NWMTACI-HPT{YYYY}", 1, 6, 2026)).toBe("NWMTACI-HPT2026000001");
    expect(googleFormId("https://docs.google.com/forms/d/1FAIpQLSabcdEFGH12345/edit")).toBe("1FAIpQLSabcdEFGH12345");
    expect(googleFormId("nope")).toBeNull();
    expect(driveFileId("https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTu/view?usp=sharing")).toBe("1aBcDeFgHiJkLmNoPqRsTu");
    expect(driveFileId("https://drive.google.com/open?id=1aBcDeFgHiJkLmNoPqRsTu")).toBe("1aBcDeFgHiJkLmNoPqRsTu");
  });
});

describe("evaluation form matching", () => {
  const c = (id: string, code: string, cat: string | null, createdAt: string, hasEvaluation = false) => ({ id, code, categoryName: cat, createdAt, hasEvaluation });
  it("matches the course code in the form title", () => {
    expect(matchEvaluationEnrollment("ATTENDANCE AND TRAINING EVALUATION SURVEY FORM - HPT-Hydraulic and Pneumatic Training", [c("a", "BSFM", null, "2026-09-01"), c("b", "HPT", null, "2026-09-20")])).toBe("b");
    expect(matchEvaluationEnrollment("ATTENDANCE AND TRAINING EVALUATION SURVEY FORM - BSFM", [c("a", "BSFM", null, "2026-09-01"), c("b", "HPT", null, "2026-09-20")])).toBe("a");
  });
  it("uses the STCW category for the shared STCW form", () => {
    expect(matchEvaluationEnrollment("POST TRAINING EVALUATION FORM - STCW COURSES", [c("a", "PSCMT", "STCW Courses", "2026-10-01"), c("b", "MEFA", "Medical", "2026-10-02")])).toBe("a");
  });
  it("prefers the enrollment still without an evaluation, else gives up when unclear", () => {
    expect(matchEvaluationEnrollment("POST TRAINING EVALUATION FORM - STCW COURSES", [c("a", "PSCMT", "STCW", "2026-10-05", true), c("b", "PSCMHBT", "STCW", "2026-10-01")])).toBe("b");
    expect(matchEvaluationEnrollment("EVALUATION FORM - XYZ", [c("a", "MEFA", null, "2026-10-01"), c("b", "SSO", null, "2026-10-02")])).toBeNull();
    expect(matchEvaluationEnrollment("EVALUATION FORM - XYZ", [c("a", "MEFA", null, "2026-10-01")])).toBe("a");
  });
});
