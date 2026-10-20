import { describe, expect, it } from "vitest";
import { matchTemplateFiles } from "../lib/certificate-rules";

const courses = [
  { id: "hpt", code: "HPT", name: "Hydraulic and Pneumatic Training" },
  { id: "hz", code: "HAZMAT", name: "Hazardous Materials" },
  { id: "hzc", code: "HAZMAT-CFR", name: "Hazardous Materials with CFR" },
  { id: "ecdis", code: "ECDIS", name: "Electronic Chart Display" },
];

describe("matchTemplateFiles", () => {
  it("matches the course code as a whole word, longest code first", () => {
    const r = matchTemplateFiles(["HPT.pdf", "HAZMAT-CFR Certificate.pdf", "hazmat cert.PDF", "HPTX.pdf"], courses);
    expect(r.map((x) => x.courseId)).toEqual(["hpt", "hzc", "hz", null]);
  });
  it("falls back to the course name and leaves unknown files unmatched", () => {
    const r = matchTemplateFiles(["Electronic Chart Display - template.pdf", "Notes.pdf"], courses);
    expect(r.map((x) => x.courseId)).toEqual(["ecdis", null]);
  });
});

describe("nextOf", () => {
  it("continues from the last Certificate No. used", async () => {
    const { nextOf } = await import("../lib/certificate-rules");
    expect(nextOf("149")).toBe(150);
    expect(nextOf("")).toBe(1);
    expect(nextOf("-3")).toBe(1);
  });
});
