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

describe("matchTemplateFiles, CODE - Course Name files", () => {
  const list = [
    { id: "haccp", code: "HACCP", name: "Hazard Analysis and Critical Control" },
    { id: "huph", code: "HUPH", name: "HACCP and United State Public Points" },
    { id: "ghh", code: "GHH", name: "Galley Hygiene with HACCP" },
    { id: "fh", code: "FH-HACCP", name: "Food Hygiene with HACCP" },
    { id: "marpol", code: "MARPOL", name: "Consolidated MARPOL Annex I-VI" },
  ];
  it("gives a file to the code it starts with, not a longer code further along", () => {
    const r = matchTemplateFiles(["HUPH - HACCP and United State Public Health.pdf", "GHH - Galley Hygiene with HACCP.pdf", "FH-HACCP - Food Hygiene with HACCP.pdf"], list);
    expect(r.map((x) => x.courseId)).toEqual(["huph", "ghh", "fh"]);
  });
  it("matches an unknown leading code by the full course name only", () => {
    const r = matchTemplateFiles(["MARPOL-3DAY - Consolidated MARPOL Annex I-VI.pdf", "MARPOL-5DAY - Consolidated MARPOL Annexes I-VI.pdf", "ILO - Food Hygiene with HACCP.pdf", "ILO - Something with HACCP.pdf"], list);
    expect(r.map((x) => x.courseId)).toEqual(["marpol", null, "fh", null]);
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
