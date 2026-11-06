import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PortalData } from "@/components/portal-live-app";
import { ReleasingCertificates } from "@/components/portal/releasing-home";
import { softCopyLine } from "@/lib/certificate-rules";
import { certificateContext, softCopyEmailVariables, trySendSoftCopy } from "@/lib/certificates";
import { processEmailJobs, renderTemplate, sendWaitingSoftCopies, softCopyAfterPrint } from "@/lib/email-jobs";

const mail = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: mail.send }; } }));

// The Releasing Officer's page opens on To Print; these rows are on To Release.
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useState: (init: unknown) => react.useState(init === "To Print" ? "To Release" : init) };
});

/** Answers every query from one row per table, whatever the filters: each fixture is a single enrollment. */
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const writes: { table: string; op: "insert" | "update"; row: Record<string, unknown>; filters: unknown[][] }[] = [];
  const from = (table: string) => {
    let wrote: "insert" | "update" | null = null;
    const filters: unknown[][] = [];
    const chain: Record<string, unknown> = {
      insert: (row: Record<string, unknown>) => { wrote = "insert"; writes.push({ table, op: "insert", row, filters }); return chain; },
      update: (row: Record<string, unknown>) => { wrote = "update"; writes.push({ table, op: "update", row, filters }); return chain; },
      maybeSingle: async () => ({ data: wrote === "insert" ? { id: "job-1" } : tables[table]?.[0] ?? null, error: null }),
      then: (done: (v: unknown) => void) => done({ data: wrote ? null : tables[table] ?? [], error: null }),
    };
    for (const name of ["select", "eq", "neq", "in", "not", "gt", "is", "contains", "order", "limit"]) chain[name] = (...args: unknown[]) => { filters.push([name, ...args]); return chain; };
    return chain;
  };
  const storage = { from: (bucket: string) => ({ download: async () => ({ data: bucket === "certificate-templates" ? tables.__file?.[0]?.blob ?? null : null, error: null }) }) };
  return { from, storage, rpc: async () => ({ data: null, error: null }), writes } as never as { from: typeof from; writes: typeof writes };
}

const enrollment = { id: "e1", enrollment_number: "ENR-1", course_id: "c1", trainee_id: "t1", enrollment_status: "Enrolled", selling_price_centavos: 130000, partner_offer_id: null, batch_id: "b1", scheduled_on: null, company_charge_agency_id: null,
  batches: { starts_on: "2026-11-03", ends_on: "2026-11-04", batch_number: "26-1" }, courses: { id: "c1", name: "Crowd Management", code: "PSCMT", duration_label: "2 Days", delivery_type: "In-House" }, trainees: { legal_first_name: "JUAN", legal_middle_name: null, legal_last_name: "DELA CRUZ", email: "juan@example.com" } };
const printed = { id: "cert-1", status: "Printed", certificate_number: "NWM-1", batch_label: null, print_count: 1, reprints_allowed: 0, void_status: null, soft_copy_sent_at: null, printed_at: "2026-11-05T17:30:00Z", verify_code: "ABCDEFGHJKMN", snapshot: {} };
const db = (over: { enrollment?: object; cert?: object; paid?: number; feedback?: boolean; tables?: Record<string, Record<string, unknown>[]> } = {}) => fakeDb({
  enrollments: [{ ...enrollment, ...over.enrollment }],
  certificates: [{ ...printed, ...over.cert }],
  payment_allocations: [{ amount_centavos: over.paid ?? 130000, payments: { received_at: "2026-11-01T00:00:00Z", valid: true } }],
  training_feedback: over.feedback === false ? [] : [{ id: "f1", submitted_at: "2026-11-04T00:00:00Z" }],
  organization_settings: [{ certificate_issuance_enabled: true }],
  certificate_photos: [{ storage_path: "a", file_name: "a.jpg" }],
  ...over.tables,
});
const jobs = (d: ReturnType<typeof db>) => d.writes.filter((w) => w.table === "email_jobs" && w.op === "insert");

describe("Soft copy · when it goes out", () => {
  it("does not go out while the certificate is only Due", async () => {
    const d = db({ cert: { status: "Ready to Print", print_count: 0, printed_at: null } });
    expect(await trySendSoftCopy(d as never, "e1")).toEqual({ state: "Skipped", why: "Only a printed certificate can be sent." });
    expect(jobs(d)).toEqual([]);
  });
  it("goes out when printed and paid, once per print", async () => {
    const d = db();
    expect(await trySendSoftCopy(d as never, "e1")).toMatchObject({ state: "Queued", jobId: "job-1", to: "juan@example.com" });
    expect(jobs(d)[0].row).toMatchObject({ template_code: "certificate.softcopy", recipient: "juan@example.com", idempotency_key: "certificate-softcopy:cert-1:print-1" });
    expect(d.writes.some((w) => w.table === "certificates" && "soft_copy_sent_at" in w.row)).toBe(true);
    const reprint = db({ cert: { print_count: 2 } });
    await trySendSoftCopy(reprint as never, "e1");
    expect(jobs(reprint)[0].row.idempotency_key).toBe("certificate-softcopy:cert-1:print-2");
  });
  it("waits for a balance", async () => {
    const d = db({ paid: 65000 });
    expect(await trySendSoftCopy(d as never, "e1")).toMatchObject({ state: "Skipped", why: expect.stringContaining("balance") });
    expect(jobs(d)).toEqual([]);
  });
  it("sends at printing on a Company Charge, with no payment", async () => {
    const d = db({ enrollment: { company_charge_agency_id: "agency-1" }, tables: { payment_allocations: [] } });
    expect(await trySendSoftCopy(d as never, "e1")).toMatchObject({ state: "Queued" });
  });
  it("waits for an approved post-test not yet passed", async () => {
    const d = db({ tables: { post_tests: [{ course_id: "c1" }], post_test_attempts: [] } });
    expect(await trySendSoftCopy(d as never, "e1")).toEqual({ state: "Skipped", why: "Post-test not passed yet." });
    const passed = db({ tables: { post_tests: [{ course_id: "c1" }], post_test_attempts: [{ enrollment_id: "e1", score: 8, total: 10, percent: 80, passed: true }] } });
    expect(await trySendSoftCopy(passed as never, "e1")).toMatchObject({ state: "Queued" });
  });
  it("skips without an email, and a revoked certificate", async () => {
    expect(await trySendSoftCopy(db({ enrollment: { trainees: { ...enrollment.trainees, email: null } } }) as never, "e1")).toEqual({ state: "Skipped", why: "The trainee has no email on record." });
    expect(await trySendSoftCopy(db({ cert: { revoked_at: "2026-11-06T00:00:00Z" } }) as never, "e1")).toMatchObject({ state: "Skipped" });
  });
  it("sends once on its own; Resend sends again and replaces one still queued", async () => {
    const sent = { soft_copy_sent_at: "2026-11-06T00:00:00Z" };
    const d = db({ cert: sent });
    expect(await trySendSoftCopy(d as never, "e1")).toEqual({ state: "Already sent" });
    expect(jobs(d)).toEqual([]);
    const again = db({ cert: sent });
    expect(await trySendSoftCopy(again as never, "e1", { force: true })).toMatchObject({ state: "Queued" });
    expect(String(jobs(again)[0].row.idempotency_key)).toMatch(/^certificate-softcopy:cert-1:\d+$/);
    const replaced = again.writes.find((w) => w.table === "email_jobs" && w.op === "update")!;
    expect(replaced.row).toMatchObject({ state: "Failed" });
    expect(replaced.filters).toContainEqual(["contains", "variables", { attach_certificate_for: "e1" }]);
  });
});

describe("Soft copy · the email", () => {
  const ctxOf = async (over: Parameters<typeof db>[0] = {}) => (await certificateContext(db(over) as never, "e1"))!;
  it("keeps the printed day as the Date of Issue, in Manila time, so a later resend matches the paper", async () => {
    const v = softCopyEmailVariables(await ctxOf());
    expect(v.issued_on).toBe("November 6, 2026");
    expect(v.training_dates).toBe("November 3 to 4, 2026");
    expect(v.first_name).toBe("Juan");
    expect(v.details_html).toContain("Date of Issue");
    expect(v.details_html).not.toContain("Registration No.");
  });
  it("uses the Admin's corrections and escapes them", async () => {
    const ctx = await ctxOf();
    const v = softCopyEmailVariables({ ...ctx, corrections: { courseName: "Crowd <b>", issuedOn: "2026-12-01", endsOn: "2026-12-02" }, batch: { ...ctx.batch, starts_on: "2026-11-30", ends_on: "2026-11-30" }, numbers: { reg: "REG-9", nextReg: null } });
    expect(v.details_html).toContain("Crowd &lt;b&gt;");
    expect(v.details_html).toContain("REG-9");
    expect(v.issued_on).toBe("December 1, 2026");
    expect(v.training_dates).toBe("November 30 to December 2, 2026");
  });
  it("hides the Verify button without a code", async () => {
    expect(softCopyEmailVariables(await ctxOf()).verify_block_html).toContain("/verify/ABCD-EFGH-JKMN");
    expect(softCopyEmailVariables(await ctxOf({ cert: { verify_code: null } })).verify_block_html).toBe("");
  });
  it("fills every placeholder of template version 2", async () => {
    const sql = readFileSync("supabase/migrations/202610290084_soft_copy_email.sql", "utf8");
    const v = softCopyEmailVariables(await ctxOf());
    for (const key of new Set([...sql.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))) expect(v).toHaveProperty(key);
    const html = renderTemplate(sql, v, true);
    expect(html).toContain("Dear Juan, your certificate has been printed");
    expect(html).toContain("Verify This Certificate");
    expect(html).toContain("/certificate-delivery");
    expect(html).not.toContain("{{");
  });
});

describe("Soft copy · sending", () => {
  /** A printed certificate, its template file and its queued email, with the mail provider faked. */
  async function ready(over: Parameters<typeof db>[0] = {}) {
    vi.stubEnv("RESEND_API_KEY", "test"); vi.stubEnv("EMAIL_FROM", "New Wave <test@example.com>");
    mail.send.mockReset().mockResolvedValue({ data: { id: "provider-1" }, error: null });
    const template = await PDFDocument.create(); template.addPage([600, 400]).drawText("Template");
    return db({ ...over, tables: {
      certificate_templates: [{ id: "tpl-1", storage_path: "c1/none.pdf", drive_file_id: null, fields: {} }],
      __file: [{ blob: new Blob([Buffer.from(await template.save())]) }],
      email_jobs: [{ id: "job-1", template_code: "certificate.softcopy", recipient: "juan@example.com", state: "Queued", attempts: 0, variables: { trainee_name: "JUAN DELA CRUZ", course_name: "Crowd Management", certificate_number: "NWM-1", attach_certificate_for: "e1" } }],
      email_templates: [{ subject: "Your Certificate of Completion · {{course_name}}", body_html: "Dear {{first_name}}<table>{{details_html}}</table>{{verify_block_html}}", body_text: "Date of Issue: {{issued_on}}" }],
      ...over.tables,
    } });
  }
  it("after a print: clears the last send, then emails the PDF with the printed details", async () => {
    const d = await ready({ cert: { soft_copy_sent_at: null } });
    await softCopyAfterPrint(d as never, "e1", "cert-1", "staff-1");
    expect(d.writes[0]).toMatchObject({ table: "certificates", op: "update", row: { soft_copy_sent_at: null } });
    expect(mail.send).toHaveBeenCalledTimes(1);
    const message = mail.send.mock.calls[0][0];
    expect(message).toMatchObject({ to: "juan@example.com", subject: "Your Certificate of Completion · Crowd Management", text: "Date of Issue: November 6, 2026" });
    expect(message.html).toContain("Dear Juan<table>");
    expect(message.html).toContain("NWM-1");
    expect(message.html).toContain("Verify This Certificate");
    expect(message.attachments[0].filename).toBe("certificate-NWM-1.pdf");
    expect((await PDFDocument.load(message.attachments[0].content)).getPageCount()).toBe(1);
    expect(d.writes.some((w) => w.table === "email_jobs" && w.row.state === "Sent")).toBe(true);
  });
  it("after a payment or a post-test: sends what was waiting, and nothing while a balance remains", async () => {
    const d = await ready({ cert: { soft_copy_sent_at: null } });
    await sendWaitingSoftCopies(d as never, ["e1"]);
    expect(mail.send).toHaveBeenCalledTimes(1);
    const unpaid = await ready({ cert: { soft_copy_sent_at: null }, paid: 65000 });
    await sendWaitingSoftCopies(unpaid as never, ["e1"]);
    expect(mail.send).not.toHaveBeenCalled();
    expect(jobs(unpaid)).toEqual([]);
  });
  it("does not email what stopped qualifying while its email waited: revoked, not printed, or a payment voided", async () => {
    for (const over of [{ cert: { revoked_at: "2026-11-06T00:00:00Z" } }, { cert: { status: "Ready to Print", print_count: 0, printed_at: null } }, { paid: 65000 }]) {
      await processEmailJobs(await ready(over) as never, { ids: ["job-1"] });
      expect(mail.send).not.toHaveBeenCalled();
    }
  });
});

describe("Soft copy · the line on the row", () => {
  const base = { email: "juan@example.com", printedAt: "2026-11-05T02:00:00Z", balanceCentavos: 0, evaluationRequired: true, evaluationOn: "in" };
  const job = { state: "Sent", sent_at: "2026-11-05T03:00:00Z", last_error: null, created_at: "2026-11-05T02:30:00Z" };
  it("says what happened", () => {
    expect(softCopyLine({ ...base, job })).toMatchObject({ tone: "sent", text: "Soft Copy Sent", on: job.sent_at, canSend: true });
    expect(softCopyLine({ ...base, job: { ...job, state: "Failed", last_error: "Bad address" } })).toMatchObject({ tone: "fail", text: "Soft Copy Failed", failed: true, title: "Bad address" });
    expect(softCopyLine({ ...base, job: { ...job, state: "Queued", last_error: "Timed out" } })).toMatchObject({ tone: "fail", failed: true });
    expect(softCopyLine({ ...base, job: { ...job, state: "Queued" } })).toMatchObject({ tone: "wait", text: "Soft Copy Sending" });
    expect(softCopyLine({ ...base })).toMatchObject({ tone: "none", text: "Soft Copy Not Sent", canSend: true });
  });
  it("says what it waits for, and offers no resend then", () => {
    expect(softCopyLine({ ...base, balanceCentavos: 50000 })).toMatchObject({ tone: "wait", text: "Sends When Balance Is Paid", canSend: false });
    expect(softCopyLine({ ...base, postTestRequired: true, postTestPassed: false })).toMatchObject({ text: "Sends When Post-Test Is Passed", canSend: false });
    expect(softCopyLine({ ...base, evaluationOn: null })).toMatchObject({ text: "Sends When Evaluation Is In", canSend: false });
    expect(softCopyLine({ ...base, email: "" })).toMatchObject({ text: "No Email on Record", canSend: false });
  });
  it("ignores an email from before the latest print, and shows a stuck send as failed", () => {
    expect(softCopyLine({ ...base, printedAt: "2026-11-06T02:00:00Z", job, balanceCentavos: 50000 }).text).toBe("Sends When Balance Is Paid");
    expect(softCopyLine({ ...base, printedAt: "2026-11-06T02:00:00Z", job, sentAt: "2026-11-05T03:00:00Z" })).toMatchObject({ text: "Soft Copy Sent", on: "2026-11-05T03:00:00Z" });
    expect(softCopyLine({ ...base, job: { ...job, state: "Processing" }, now: Date.parse(job.created_at) + 60_000 }).text).toBe("Soft Copy Sending");
    expect(softCopyLine({ ...base, job: { ...job, state: "Processing" }, now: Date.parse(job.created_at) + 3_600_000 })).toMatchObject({ text: "Soft Copy Failed", failed: true });
  });
  it("shows on To Release, with Resend when it failed and the menu's Resend Soft Copy", () => {
    const course = { id: "c1", name: "Anti Piracy Awareness", code: "APA", delivery_type: "In-House", duration_label: "1 Day", course_categories: { name: "Maritime In-House" } };
    const row = (id: string, last: string, email: string | null, paid = 130000) => ({ id, enrollment_number: `ENR-${id}`, enrollment_status: "Enrolled", course_id: "c1", trainee_id: `t-${id}`, scheduled_on: "2026-10-01", created_at: "2026-10-01T00:00:00Z", selling_price_centavos: 130000, charges_centavos: 0, discounts_centavos: 0, paid_centavos: paid, partner_offer_id: null, batches: null, courses: course, trainees: { legal_first_name: "Juan", legal_last_name: last, trainee_number: `NWM-${id}`, email } });
    const cert = (id: string) => ({ id: `cert-${id}`, enrollment_id: id, status: "Printed", print_count: 1, reprints_allowed: 0, certificate_number: `NWM-${id}`, printed_at: "2026-11-05T02:00:00Z" });
    const ids = ["sent", "fail", "wait", "none"];
    const html = renderToStaticMarkup(createElement(ReleasingCertificates, { reload: async () => undefined, data: {
      courses: [course], payments: [], certificateReleases: [], deliveryRequests: [], applicationNumbers: {}, companyCharge: {}, certificatePhotos: [],
      feedbackAt: Object.fromEntries(ids.map((id) => [id, "2026-10-02T00:00:00Z"])), certificates: ids.map(cert),
      enrollments: [row("sent", "SENT", "a@example.com"), row("fail", "FAIL", "b@example.com"), row("wait", "WAIT", "c@example.com", 65000), row("none", "NONE", null)],
      softCopyEmails: { sent: { ...job, to: "a@example.com" }, fail: { ...job, state: "Failed", sent_at: null, last_error: "Bad address", to: "b@example.com" } },
    } as unknown as PortalData }));
    expect(html).toContain("Certificate No.</th>");
    expect(html).toMatch(/st-soft sent[^>]*>Soft Copy Sent · Nov 5/);
    expect(html).toMatch(/st-soft fail[^>]*>Soft Copy Failed<button[^>]*>Resend<\/button>/);
    expect(html).toContain("Sends When Balance Is Paid");
    expect(html).toContain("No Email on Record");
    expect(html.match(/>Resend Soft Copy</g)).toHaveLength(2);
    expect(html).not.toContain("Email Soft Copy");
  });
});
