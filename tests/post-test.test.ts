import { describe, expect, it } from "vitest";
import { passMark, picksProblem, questionsProblem, scorePostTest, forTrainee, type PostTestQuestion } from "../lib/post-test";
import { draftFor } from "../lib/post-test-server";
import { trainingEndBody } from "../lib/training-end-email";
import { releaseProblem } from "../lib/certificate-rules";
import { bundledLayout } from "../lib/certificate-template-layouts";
import { conductedText } from "../lib/certificate-overlay";

const qs: PostTestQuestion[] = Array.from({ length: 10 }, (_, i) => ({ q: `Question number ${i + 1}?`, options: ["Alpha", "Bravo", "Charlie", "Delta"], answer: i % 4, why: "Because." }));
const right = qs.map((q) => q.answer);

describe("post-test scoring", () => {
  it("passes at 70% (7 of 10) and not below", () => {
    expect(passMark(10, 70)).toBe(7);
    expect(scorePostTest(qs, right, 70)).toMatchObject({ score: 10, percent: 100, passed: true });
    const seven = right.map((a, i) => (i < 3 ? (a + 1) % 4 : a));
    expect(scorePostTest(qs, seven, 70)).toMatchObject({ score: 7, passed: true });
    const six = right.map((a, i) => (i < 4 ? (a + 1) % 4 : a));
    expect(scorePostTest(qs, six, 70)).toMatchObject({ score: 6, percent: 60, passed: false });
  });
  it("needs every question answered with a real choice", () => {
    expect(picksProblem(qs, right)).toBeNull();
    expect(picksProblem(qs, right.slice(0, 9))).toMatch(/every/);
    expect(picksProblem(qs, [...right.slice(0, 9), 4])).toMatch(/every/);
  });
  it("never sends answers to the trainee", () => {
    expect(forTrainee(qs)[0]).toEqual({ q: "Question number 1?", options: ["Alpha", "Bravo", "Charlie", "Delta"] });
  });
  it("checks the Admin's edits", () => {
    expect(questionsProblem(qs)).toBeNull();
    expect(questionsProblem(qs.slice(0, 9))).toMatch(/at least 10/);
    expect(questionsProblem([...qs.slice(0, 9), { ...qs[9], options: ["A", "A", "B", "C"] }])).toMatch(/same choice/);
    expect(questionsProblem([...qs.slice(0, 9), { ...qs[9], answer: 5 }])).toMatch(/correct answer/);
  });
});

describe("drafted questions", () => {
  it("match a course by code, and the ILO catering courses by name", () => {
    expect(draftFor({ code: "ECDIS", name: "Anything" })).toHaveLength(10);
    expect(draftFor({ code: "ILO", name: "Basic Arabic Course" })).toHaveLength(10);
    expect(draftFor({ code: "ZZZ", name: "No Such Course" })).toBeNull();
  });
  it("each has 4 different choices and a valid answer", () => {
    for (const code of ["ABC", "HPT", "WH", "SOC"]) expect(questionsProblem(draftFor({ code, name: "" }))).toBeNull();
  });
});

describe("end-of-training email", () => {
  const base = { firstName: "Juan", traineeName: "Juan Dela Cruz", nwmtaciNo: "NWMTACI-0000012", courseName: "Operational Use of ECDIS", courseCode: "ECDIS", dates: "Oct 12 - Oct 16, 2026", time: "8:00 AM - 5:00 PM", mode: "Online", batch: "BCH-2026-0412" };
  it("shows the post-test and the evaluation while both are to do", () => {
    const b = trainingEndBody({ ...base, postTest: { url: "https://x/post-test/t", passingPercent: 70, total: 10 }, evaluationUrl: "https://x/feedback/t" });
    expect(b.html).toContain("Take the Post-Test");
    expect(b.html).toContain("Evaluate the Training");
    expect(b.html).toContain("70% (7 correct)");
    expect(b.steps).toBe("post-test and training evaluation");
    expect(b.html).toContain("How to Take the Post-Test and Evaluation");
    expect(b.html).toContain("registration-search");
  });
  it("leaves out what is already done", () => {
    const b = trainingEndBody({ ...base, postTest: null, evaluationUrl: "https://x/feedback/t" });
    expect(b.html).not.toContain("Post-Test");
    expect(trainingEndBody({ ...base, postTest: null, evaluationUrl: null }).steps).toBe("");
  });
});

describe("release with the post-test", () => {
  it("waits for a pass once the course's test is live", () => {
    expect(releaseProblem({ balanceCentavos: 0, evaluationRequired: true, evaluationOn: "2026-10-20", postTestRequired: true, postTestPassed: false })).toMatch(/Post-test/);
    expect(releaseProblem({ balanceCentavos: 0, evaluationRequired: true, evaluationOn: "2026-10-20", postTestRequired: true, postTestPassed: true })).toBeNull();
    expect(releaseProblem({ balanceCentavos: 0, evaluationRequired: true, evaluationOn: "2026-10-20", postTestRequired: false })).toBeNull();
  });
});

describe("CSF is a 1-day course", () => {
  it("prints one date, 8 hours and fills the hours line", () => {
    const f = bundledLayout("c/0b6f2a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b-CSF---Container-Ship-Familiarization.pdf");
    expect(f?.hours?.text).toBe("8 Hours");
    expect(conductedText(f!.conducted!.text, "2026-10-21", "2026-10-21")).toMatch(/^Conducted on October 21, 2026, with a total of 8 hours/);
  });
});
