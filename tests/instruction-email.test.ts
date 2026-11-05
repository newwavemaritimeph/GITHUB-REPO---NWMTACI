import { describe, expect, it, vi } from "vitest";
vi.mock("resend", () => ({ Resend: class {} }));
import { classroomEmailBlocks, classroomJoin } from "@/lib/classroom";
import { renderTemplate } from "@/lib/email-jobs";
import { emailResult, emailStatusText, instructionRecipient, instructionSendText, sentTimes } from "@/lib/instruction-email-status";

describe("Google Classroom join link", () => {
  it("adds the class code to the class link", () => {
    expect(classroomJoin("https://classroom.google.com/c/NzM2", "abc1def")).toEqual({ url: "https://classroom.google.com/c/NzM2?cjc=abc1def", code: "abc1def" });
  });
  it("keeps a link that already carries a code, and falls back to the code alone", () => {
    expect(classroomJoin("https://classroom.google.com/c/NzM2?cjc=xyz", "abc").url).toBe("https://classroom.google.com/c/NzM2?cjc=xyz");
    expect(classroomJoin(null, "abc")).toEqual({ url: "https://classroom.google.com/", code: "abc" });
    expect(classroomJoin("", "")).toEqual({ url: null, code: null });
    expect(classroomJoin("https://evil.example/x", null).url).toBeNull();
  });
  it("leaves the Classroom block out when the course has no class", () => {
    expect(classroomEmailBlocks({ url: null, code: null })).toEqual({ html: "", text: "" });
    expect(classroomEmailBlocks(classroomJoin("https://classroom.google.com/c/NzM2", "abc1def")).html).toContain("Join Google Classroom");
  });
});

describe("Instructions email", () => {
  it("escapes trainee data in HTML but keeps server-built blocks", () => {
    const html = renderTemplate("<p>{{trainee_name}}</p>{{classroom_block_html}}", { trainee_name: "<b>JUAN</b>", classroom_block_html: "<div>ok</div>" }, true);
    expect(html).toBe("<p>&lt;b&gt;JUAN&lt;/b&gt;</p><div>ok</div>");
  });
  it("describes the latest email for Registration", () => {
    expect(emailStatusText({ state: "Sent", to: "juan@gmail.com", sent_at: null, last_error: null, created_at: "2026-10-07T07:00:00Z" })).toBe("Emailed to juan@gmail.com");
    expect(emailStatusText({ state: "Queued", to: "juan@gmail.com", sent_at: null, last_error: "x", created_at: "2026-10-07T07:00:00Z" })).toMatch(/queued/);
    expect(emailStatusText(null)).toBeNull();
  });
});

describe("Instructions window", () => {
  it("changes the record only when the box is ticked and the address differs", () => {
    expect(instructionRecipient("juan@gmail.com", "new@gmail.com", true)).toEqual({ to: "new@gmail.com", saveToRecord: true });
    expect(instructionRecipient("juan@gmail.com", "new@gmail.com", false)).toEqual({ to: "new@gmail.com", saveToRecord: false });
    expect(instructionRecipient("juan@gmail.com", " JUAN@gmail.com ", true)).toEqual({ to: "juan@gmail.com", saveToRecord: false });
  });
  it("sends to the record when no address is typed", () => {
    expect(instructionRecipient("juan@gmail.com", undefined, undefined)).toEqual({ to: "juan@gmail.com", saveToRecord: false });
    expect(instructionRecipient(null, undefined, true)).toEqual({ to: null, saveToRecord: false });
  });
  it("says what happened after a send", () => {
    const sent = { state: "Sent", to: "new@gmail.com" }, invited = { state: "Invited", email: "new@gmail.com", error: null };
    expect(instructionSendText({ email: sent, classroom: invited }, true)).toEqual({ ok: true, text: "Sent to new@gmail.com. Google Classroom invitation sent. Saved as the trainee's email." });
    expect(instructionSendText({ email: sent, classroom: null }, false, "juan@gmail.com").text).toBe("Sent to new@gmail.com. This one time only. The record keeps juan@gmail.com.");
    expect(instructionSendText({ email: { state: "Queued", to: "a@b.co", error: "Quota" } }, false)).toEqual({ ok: false, text: "The email to a@b.co did not go out yet (Quota). It will retry automatically." });
    expect(instructionSendText({ email: sent, classroom: { state: "Failed", email: "a@b.co", error: "No account" } }, false).text).toContain("invitation failed: No account");
  });
  it("labels the last send and the count", () => {
    expect([emailResult("Delivered"), emailResult("Delivery Failed"), emailResult("Queued")]).toEqual(["Sent", "Failed", "Queued"]);
    expect([sentTimes(1), sentTimes(4)]).toEqual(["1 Time", "4 Times"]);
  });
});
