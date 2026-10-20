import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { EVALUATION_RATINGS, evaluationProblem, type EvaluationAnswers } from "@/lib/evaluation-form";
import { createEvaluationPdf } from "@/lib/print/evaluation";
import { evaluationNaming } from "@/lib/evaluation-drive";

const complete: EvaluationAnswers = { ratings: [5, 4, 5, 3, 4, 5, 2, 5], liked: "The hands-on drills.", suggestions: "", recommend: "Yes" };
// pdf-lib writes standard-font text as hex strings inside flate-compressed content streams.
const hex = (s: string) => Buffer.from(s, "latin1").toString("hex").toUpperCase();
function pageText(bytes: Uint8Array) {
  const buf = Buffer.from(bytes), raw = buf.toString("latin1");
  return [...raw.matchAll(/stream\r?\n/g)].map((m) => {
    const start = m.index + m[0].length;
    try { return inflateSync(buf.subarray(start, raw.indexOf("endstream", start))).toString("latin1"); } catch { return ""; }
  }).join(" ");
}

describe("portal training evaluation", () => {
  it("has the eight rated statements", () => expect(EVALUATION_RATINGS).toHaveLength(8));

  it("accepts complete answers", () => expect(evaluationProblem(complete)).toBeNull());

  it("rejects a missing, out-of-range or fractional rating", () => {
    expect(evaluationProblem({ ...complete, ratings: complete.ratings.slice(0, 7) })).toMatch(/rate every/);
    expect(evaluationProblem({ ...complete, ratings: [0, ...complete.ratings.slice(1)] })).toMatch(/rate every/);
    expect(evaluationProblem({ ...complete, ratings: [6, ...complete.ratings.slice(1)] })).toMatch(/rate every/);
    expect(evaluationProblem({ ...complete, ratings: [4.5, ...complete.ratings.slice(1)] })).toMatch(/rate every/);
  });

  it("rejects a missing recommendation, overlong text and junk", () => {
    expect(evaluationProblem({ ...complete, recommend: "Maybe" })).toMatch(/recommend/);
    expect(evaluationProblem({ ...complete, liked: "x".repeat(1001) })).toMatch(/1000/);
    expect(evaluationProblem(null)).not.toBeNull();
  });

  it("prints a PDF with every statement and survives non-WinAnsi text", async () => {
    const bytes = await createEvaluationPdf({
      traineeName: "Juan Dela Cruz Ñoño", nwmtaciNo: "NWMTACI-2026-0001", courseName: "Basic Training", courseCode: "BT",
      startsOn: "2026-10-13", endsOn: "2026-10-17", submittedAt: "2026-10-20T02:00:00Z",
      answers: { ...complete, liked: "Great 👍 训练 — thanks!\nSecond line", suggestions: "a".repeat(1000) },
    });
    expect(Buffer.from(bytes.slice(0, 4)).toString()).toBe("%PDF");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
    const text = pageText(bytes);
    expect(text).toContain(hex("TRAINING EVALUATION"));
    // Each statement starts its row (a long one wraps, so match its opening words).
    for (const [i, q] of EVALUATION_RATINGS.entries()) expect(text).toContain(hex(`${i + 1}. ${q}`.slice(0, 30)));
  });

  it("names the Drive file by course, Manila month and date", () => {
    // 5:30 PM UTC on Oct 19 is Oct 20 in Manila.
    const n = evaluationNaming({ courseCode: "bt", lastName: "dela Cruz", firstName: "Juan", submittedAt: "2026-10-19T17:30:00Z" });
    expect(n.folders.map((f) => f.name)).toEqual(["BT", "2026-10 October"]);
    expect(n.base).toBe("DELA CRUZ, Juan - BT - 2026-10-20");
  });
});
