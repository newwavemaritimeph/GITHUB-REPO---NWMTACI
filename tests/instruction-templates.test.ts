import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createTrainingInstructionsPdf } from "@/lib/documents";
import { DEFAULT_CATEGORY_TEMPLATES, emailSteps, fillPlaceholders, instructionCategoryOf, instructionEmailVariables, instructionMode, linesOf, policyPairs, remindersFor, sheetSteps } from "@/lib/instruction-templates";
import { loadInstructionDetails } from "@/lib/training-instructions";

describe("training instruction templates", () => {
  it("reads one item per line", () => expect(linesOf(" a \n\n b\n")).toEqual(["a", "b"]));
  it("drops the Classroom reminder only when the course has no class", () => {
    const lines = linesOf(DEFAULT_CATEGORY_TEMPLATES["In-House"].reminders);
    expect(lines.some((l) => /Google Classroom/.test(l))).toBe(true);
    expect(remindersFor(lines, true)).toEqual(lines);
    expect(remindersFor(lines, false).some((l) => /Google Classroom|class code/i.test(l))).toBe(false);
    expect(remindersFor(lines, false).length).toBe(lines.length - 1);
  });
  it("fills placeholders and blanks the unknown", () => expect(fillPlaceholders("Hi {{trainee}} · {{ course }} {{nope}}", { trainee: "Juan", course: "HPT" })).toBe("Hi Juan · HPT "));
  it("splits a policy at its label", () => expect(policyPairs("Payment: Full: 50%\nNo label here")).toEqual([["Payment", "Full: 50%"], ["", "No label here"]]));
  it("sorts courses into STCW and In-House", () => {
    expect(instructionCategoryOf("HPT", "In-House Courses")).toBe("In-House");
    expect(instructionCategoryOf("XYZ", "STCW Courses")).toBe("STCW");
    expect(instructionCategoryOf("pscmt", null)).toBe("STCW");
  });
  it("gives five steps, by online or in person", () => {
    expect(sheetSteps(true, true)[0][1]).toContain("Google Classroom");
    expect(sheetSteps(false, false)[1][1]).toContain("7:30 AM");
    expect(emailSteps(false, false, "Room 2", "Nov 10, 2026")[0]).toBe("Report to Room 2 by 7:30 AM on Nov 10, 2026.");
    expect(emailSteps(true, true, "Google Classroom", "Nov 12, 2026")).toHaveLength(5);
  });
});

const details = {
  subject: "Your training instructions · HPT", firstName: "Maria", formalName: "SANTOS, MARIA L.", nwmtaciNumber: "NWMTACI-0000405", srn: "2219334881", enrollmentNumber: "ENR-2026-000318", courseName: "HPT - Hazardous Products", batchNumber: "",
  dates: "Nov 12, 2026 - Nov 13, 2026", time: "8:00 AM - 5:00 PM", classroom: "Google Classroom", mode: "Online", online: true, join: { url: "https://classroom.google.com/c/abc?cjc=x7k2pqm", code: "x7k2pqm" },
  bring: ["Valid ID <today>"], reminders: ["Camera on"], policies: [["Payment", "Full"], ["", "Plain"]] as [string, string][],
};

describe("instructions email", () => {
  const v = instructionEmailVariables(details);
  it("fills what template v2 asks for", () => {
    expect(v.email_subject).toBe("Your training instructions · HPT");
    expect(v.arrive_note).toBe("log in by 7:45 AM");
    expect(v.steps_text).toContain("Log in by 7:45 AM on Nov 12, 2026");
    expect(v.classroom_block_html).toContain("Join Google Classroom");
  });
  it("escapes template text in the built HTML", () => expect(v.bring_html).toContain("Valid ID &lt;today&gt;"));
  it("leaves no SRN text when there is none", () => expect(instructionEmailVariables({ ...details, srn: "" }).srn_text).toBe(""));
});

describe("instructions sheet", () => {
  const base = { traineeName: "Maria Santos", formalName: "SANTOS, MARIA L.", nwmtaciNumber: "NWMTACI-0000405", srn: "2219334881", courseName: "HPT - Hazardous Products", batchNumber: "", dateOfTraining: "Nov 12, 2026", time: "8:00 AM - 5:00 PM", classroom: "Google Classroom", mode: "Online", online: true, googleClassroomLink: "https://classroom.google.com/c/abc", classCode: "x7k2pqm", reference: "ENR-2026-000318", issuedAt: "Nov 4, 2026", categoryLabel: "In-House Courses", steps: sheetSteps(true, true) };
  const t = DEFAULT_CATEGORY_TEMPLATES["In-House"];
  it("prints on one half-Legal page", async () => {
    const doc = await PDFDocument.load(await createTrainingInstructionsPdf({ ...base, bring: linesOf(t.bring), reminders: linesOf(t.reminders), policies: policyPairs(t.policies) }));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 504 });
  });
  it("still prints with a long template", async () => {
    const long = Array.from({ length: 8 }, (_, i) => `Item ${i} ${"with a long reminder that runs across the card ".repeat(2)}`);
    const doc = await PDFDocument.load(await createTrainingInstructionsPdf({ ...base, bring: long, reminders: long, policies: policyPairs(long.map((l) => `Rule: ${l}`).join("\n")) }));
    expect(doc.getPageCount()).toBe(1);
  });
});

describe("In-House and STCW face-to-face instructions differ", () => {
  const load = async (course: Record<string, unknown>, batch: Record<string, unknown> | null) => {
    const row = { id: "e1", enrollment_number: "ENR-1", enrollment_status: "Enrolled", course_id: "c1", batch_id: batch ? "b1" : null, scheduled_on: "2026-11-09", trainees: { id: "t1", legal_first_name: "Juan", legal_last_name: "Dela Cruz", email: "juan@example.com" }, courses: course, batches: batch };
    const db = { from: (table: string) => { const q: Record<string, unknown> = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: table === "enrollments" ? row : null }) }; return q; } };
    return (await loadInstructionDetails(db as never, "e1"))!;
  };

  it("takes the course's mode when the In-House course has no batch", async () => {
    const d = await load({ code: "APA", name: "Anti Piracy Awareness", training_mode: "Online", google_classroom_link: "https://classroom.google.com/c/abc", course_categories: { name: "Maritime In-House" } }, null);
    expect(d).toMatchObject({ category: "In-House", online: true, mode: "Online", classroom: "Google Classroom" });
    expect(sheetSteps(d.online, true).flat().join(" ")).toContain("Log in by 7:45 AM");
    expect(sheetSteps(d.online, true).flat().join(" ")).not.toMatch(/uniform|Report by/);
    expect(d.bring.join(" ")).not.toMatch(/uniform|Seaman/);
  });

  it("does not promise a class that is not linked yet", async () => {
    const d = await load({ code: "ABC", name: "Basic Computer", training_mode: "Online", course_categories: { name: "Maritime In-House" } }, null);
    expect(d.classroom).toBe("Class Link to Follow");
  });

  it("keeps the face-to-face wording for an STCW class", async () => {
    const d = await load({ code: "PSCMT", name: "Crowd Management", training_mode: "Face-to-Face", course_categories: { name: "Upcoming MARINA STCW" } }, { mode: "In-person", starts_on: "2026-11-10", ends_on: "2026-11-11", venue: "Room 103" });
    expect(d).toMatchObject({ category: "STCW", online: false, mode: "In-person", classroom: "Room 103" });
    expect(sheetSteps(d.online, false).flat().join(" ")).toContain("Report by 7:30 AM");
    expect(d.bring.join(" ")).toMatch(/uniform/);
  });

  it("lets the batch's mode win, and treats an In-House course with no mode as online", () => {
    expect(instructionMode("In-person", "Online", "In-House")).toBe("In-person");
    expect(instructionMode(null, null, "In-House")).toBe("Online");
    expect(instructionMode(null, null, "STCW")).toBe("Face-to-Face");
  });
});
