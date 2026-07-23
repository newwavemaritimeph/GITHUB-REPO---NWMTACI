import { describe, expect, it } from "vitest";
import { isCertificateEligible, isCompletionRequirementMet } from "../lib/domain";
import { nextBatchStarts, planBatches } from "../lib/scheduling";

describe("in-house completion requirement", () => {
  it("is satisfied by either the feedback form or the uploaded proof", () => {
    const base = { isNewWaveCourse: true, feedbackFormCompleted: false, completionProofUploaded: false };
    expect(isCompletionRequirementMet({ ...base, feedbackFormCompleted: true })).toBe(true);
    expect(isCompletionRequirementMet({ ...base, completionProofUploaded: true })).toBe(true);
    expect(isCompletionRequirementMet({ ...base, feedbackFormCompleted: true, completionProofUploaded: true })).toBe(true);
  });

  it("blocks a New Wave course with neither", () => {
    expect(
      isCompletionRequirementMet({ isNewWaveCourse: true, feedbackFormCompleted: false, completionProofUploaded: false }),
    ).toBe(false);
  });

  it("does not gate endorsed partner courses", () => {
    expect(
      isCompletionRequirementMet({ isNewWaveCourse: false, feedbackFormCompleted: false, completionProofUploaded: false }),
    ).toBe(true);
  });
});

describe("certificate eligibility with the completion gate", () => {
  const eligible = {
    attendance: ["Present", "Present", "Late"] as const,
    instructorSubmitted: true,
    operationsVerified: true,
    templateActive: true,
    certificateNumberAvailable: true,
    legalNameConfirmed: true,
  };

  it("stays eligible when the requirement is met", () => {
    expect(
      isCertificateEligible({
        ...eligible,
        completion: { isNewWaveCourse: true, feedbackFormCompleted: true, completionProofUploaded: false },
      }),
    ).toBe(true);
  });

  it("becomes ineligible when a New Wave course has neither proof nor feedback", () => {
    expect(
      isCertificateEligible({
        ...eligible,
        completion: { isNewWaveCourse: true, feedbackFormCompleted: false, completionProofUploaded: false },
      }),
    ).toBe(false);
  });

  it("still requires attendance and a template regardless of the completion step", () => {
    const completion = { isNewWaveCourse: true, feedbackFormCompleted: true, completionProofUploaded: true };
    expect(isCertificateEligible({ ...eligible, attendance: ["Present", "Absent"], completion })).toBe(false);
    expect(isCertificateEligible({ ...eligible, templateActive: false, completion })).toBe(false);
    expect(isCertificateEligible({ ...eligible, operationsVerified: false, completion })).toBe(false);
  });

  it("leaves records created before the step existed unaffected", () => {
    expect(isCertificateEligible(eligible)).toBe(true);
  });
});

describe("automatic batch opening", () => {
  it("opens the next dates matching a weekly pattern", () => {
    // PSCMT starts on Tuesdays. 2026-07-23 is a Thursday.
    expect(nextBatchStarts("PSCMT", "2 days", "2026-07-23", 3)).toEqual(["2026-07-28", "2026-08-04", "2026-08-11"]);
  });

  it("includes the starting date when it already matches", () => {
    // 2026-07-28 is itself a Tuesday.
    expect(nextBatchStarts("PSCMT", "2 days", "2026-07-28", 1)).toEqual(["2026-07-28"]);
  });

  it("derives each end date from the duration, skipping Sundays", () => {
    expect(planBatches({ code: "CCMI", durationLabel: "6 days", from: "2026-07-23", count: 2 })).toEqual([
      { startsOn: "2026-07-27", endsOn: "2026-08-01" },
      { startsOn: "2026-08-03", endsOn: "2026-08-08" },
    ]);
  });

  it("uses the picked date exactly for endorsed partner courses", () => {
    // A Sunday, which no New Wave pattern would allow.
    expect(planBatches({ code: "ANY-ENDORSED", durationLabel: "1 day", from: "2026-07-26", endorsed: true })).toEqual([
      { startsOn: "2026-07-26", endsOn: "2026-07-27" },
    ]);
  });

  it("returns nothing without a start date", () => {
    expect(planBatches({ code: "PSCMT", durationLabel: "2 days", from: "", count: 3 })).toEqual([]);
    expect(nextBatchStarts("PSCMT", "2 days", "2026-07-23", 0)).toEqual([]);
  });
});
