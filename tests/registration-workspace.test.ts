import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { PortalData } from "@/components/portal-live-app";
import { CoursesAndCenters, RegistrationDashboard, RegistrationRecords, applicationReadiness } from "@/components/portal/live-registration";

/**
 * Registration Officer workspace: renders every screen against a fixture and
 * pins the role boundary from MASTERPLAN §10 — this role reads payment status
 * but can never write a payment, charge, reschedule, or deletion — and the
 * 7 Oct 2026 rules: registrations come only from the website and are screened
 * (three requirements); a paid applicant on a batch is enrolled automatically;
 * Registration generates instructions (twice at most) but never prints the TAR.
 */

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const plus = (days: number) => { const d = new Date(`${today}T00:00:00+08:00`); d.setDate(d.getDate() + days); return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(d); };
const nowIso = new Date().toISOString();

const fixture = {
  profile: { complete_name: "Reg Officer", email: "reg@example.test" },
  roles: ["registration"],
  courses: [
    { id: "c1", code: "SSO", name: "Ship Security Officers", delivery_type: "In-House", duration_label: "3 days", standard_price_centavos: 450000, course_categories: { name: "STCW" } },
    { id: "c2", code: "ABC", name: "Awareness on Basic Computer", delivery_type: "In-House", duration_label: "1 day", standard_price_centavos: 150000, course_categories: { name: "In-House" } },
    { id: "c5", code: "PSCMT", name: "Crowd Management Training", delivery_type: "In-House", duration_label: "2 days", standard_price_centavos: 160000, course_categories: null },
    { id: "c3", code: "END", name: "Endorsed Program", delivery_type: "Partner or Endorsed", duration_label: "2 days", standard_price_centavos: 0, course_categories: null },
  ],
  offers: [{ id: "o1", course_id: "c3", duration_label: "2 days", training_fee_centavos: 800000, rebate_centavos: 50000, partner_payable_centavos: 750000, partner_centers: { name: "Partner Center A" } }],
  trainees: [
    { id: "t1", trainee_number: "NW-0001", legal_first_name: "Maria", legal_last_name: "Reyes", birthdate: "1990-01-01", email: "maria@example.test", mobile: "+639171234567", srn: "1234567890", account_state: "Active", registered_at: nowIso },
    { id: "t3", trainee_number: "NW-0003", legal_first_name: "Pedro", legal_last_name: "Cruz", birthdate: "1995-03-03", email: "pedro@example.test", mobile: "+639191234567", srn: "2234567890", account_state: "Active", registered_at: nowIso },
    { id: "t2", trainee_number: "NW-0002", legal_first_name: "Juan", legal_last_name: "Santos", birthdate: "1992-02-02", email: "juan@example.test", mobile: "+639181234567", srn: null, account_state: "Active", registered_at: nowIso },
  ],
  batches: [
    { id: "b1", batch_number: "SSO-2610", course_id: "c1", partner_offer_id: null, starts_on: plus(5), ends_on: plus(7), mode: "Face-to-face", venue: "Room 1", capacity: 24, confirmed_count: 3, enrollment_deadline: `${plus(4)}T23:59:59+08:00`, status: "Open", published_at: nowIso, courses: { name: "Ship Security Officers", code: "SSO" } },
    { id: "b5", batch_number: "PSCMT-2610", course_id: "c5", partner_offer_id: null, starts_on: plus(6), ends_on: plus(7), mode: "Face-to-face", venue: null, capacity: 24, confirmed_count: 21, enrollment_deadline: `${plus(6)}T07:00:00+08:00`, status: "Open", published_at: nowIso, courses: { name: "Crowd Management Training", code: "PSCMT" } },
    { id: "b2", batch_number: "SSO-FULL", course_id: "c1", partner_offer_id: null, starts_on: plus(9), ends_on: plus(11), mode: "Face-to-face", venue: null, capacity: 24, confirmed_count: 24, enrollment_deadline: `${plus(8)}T23:59:59+08:00`, status: "Full", published_at: nowIso, courses: { name: "Ship Security Officers", code: "SSO" } },
  ],
  enrollments: [
    { id: "e1", enrollment_number: "ENR-0001", trainee_id: "t1", course_id: "c1", partner_offer_id: null, batch_id: "b1", enrollment_status: "Enrolled", enrolled_at: nowIso, selling_price_centavos: 450000, rebate_centavos: 0, partner_payable_centavos: 0, paid_centavos: 200000, charges_centavos: 0, discounts_centavos: 0, created_at: nowIso, source: "Public registration", trainees: { trainee_number: "NW-0001", legal_first_name: "Maria", legal_last_name: "Reyes", email: "maria@example.test", mobile: "+639171234567" }, courses: { name: "Ship Security Officers", code: "SSO" }, batches: { batch_number: "SSO-2610", starts_on: plus(5), ends_on: plus(7), mode: "Face-to-face", venue: "Room 1" } },
    { id: "e2", enrollment_number: "ENR-0002", trainee_id: "t2", course_id: "c2", partner_offer_id: null, batch_id: null, enrollment_status: "Open Schedule", selling_price_centavos: 150000, rebate_centavos: 0, partner_payable_centavos: 0, paid_centavos: 0, created_at: nowIso, source: "Staff-assisted registration", trainees: { trainee_number: "NW-0002", legal_first_name: "Juan", legal_last_name: "Santos", email: "juan@example.test", mobile: "+639181234567" }, courses: { name: "Awareness on Basic Computer", code: "ABC" }, batches: null },
    { id: "e4", enrollment_number: "ENR-0004", trainee_id: "t1", course_id: "c1", partner_offer_id: null, batch_id: "b1", enrollment_status: "Pending", selling_price_centavos: 450000, rebate_centavos: 0, partner_payable_centavos: 0, paid_centavos: 100000, verified_paid_centavos: 100000, created_at: nowIso, source: "Public registration", trainees: { trainee_number: "NW-0001", legal_first_name: "Maria", legal_last_name: "Reyes", email: "maria@example.test", mobile: "+639171234567" }, courses: { name: "Ship Security Officers", code: "SSO" }, batches: { batch_number: "SSO-2610", starts_on: plus(5), ends_on: plus(7), mode: "Face-to-face", venue: "Room 1" } },
    { id: "e5", enrollment_number: "ENR-0005", trainee_id: "t2", course_id: "c1", partner_offer_id: null, batch_id: "b1", enrollment_status: "Pending", selling_price_centavos: 450000, rebate_centavos: 0, partner_payable_centavos: 0, paid_centavos: 0, verified_paid_centavos: 0, created_at: nowIso, source: "Public registration", trainees: { trainee_number: "NW-0002", legal_first_name: "Juan", legal_last_name: "Santos", email: "juan@example.test", mobile: "+639181234567" }, courses: { name: "Ship Security Officers", code: "SSO" }, batches: { batch_number: "SSO-2610", starts_on: plus(5), ends_on: plus(7), mode: "Face-to-face", venue: "Room 1" } },
    { id: "e6", enrollment_number: "ENR-0006", trainee_id: "t3", course_id: "c1", partner_offer_id: null, batch_id: "b9", enrollment_status: "Enrolled", enrolled_at: "2026-01-01T02:00:00Z", selling_price_centavos: 450000, rebate_centavos: 0, partner_payable_centavos: 0, paid_centavos: 450000, created_at: "2026-01-01T00:00:00Z", source: "Public registration", trainees: { trainee_number: "NW-0003", legal_first_name: "Pedro", legal_last_name: "Cruz", email: "pedro@example.test", mobile: "+639191234567" }, courses: { name: "Ship Security Officers", code: "SSO" }, batches: { batch_number: "SSO-TMRW", starts_on: plus(1), ends_on: plus(1), mode: "Face-to-face", venue: "Room 2" } },
    { id: "e3", enrollment_number: "ENR-0003", trainee_id: "t2", course_id: "c1", partner_offer_id: null, batch_id: null, enrollment_status: "Cancelled", selling_price_centavos: 450000, rebate_centavos: 0, partner_payable_centavos: 0, paid_centavos: 0, created_at: nowIso, trainees: { trainee_number: "NW-0002", legal_first_name: "Juan", legal_last_name: "Santos", email: "juan@example.test", mobile: "+639181234567" }, courses: { name: "Ship Security Officers", code: "SSO" }, batches: null },
  ],
  payments: [{ id: "p1", payment_number: "PAY-0001", trainee_id: "t1", amount_centavos: 200000, method: "GCash", receiving_account: "Main", reference_number: "GC123", received_at: nowIso, verification_state: "Pending" }],
  notifications: [], paymentMethods: [], charges: [], agencies: [], expenses: [], payables: [], cashierClosings: [], enrollmentCharges: [],
  employees: [], employeeAttendance: [], leaveRequests: [], cashAdvances: [], payrollPeriods: [], payrollItems: [], benefitRecords: [], employmentContracts: [],
  classrooms: [], certificates: [], certificateTemplates: [], certificateReleases: [], certificateIssuanceEnabled: false,
  agencyCourseRebates: [], agencyRebates: [], expenseCategories: [], inventoryItems: [], inventoryMovements: [], pendingDiscounts: [],
  announcements: [{ id: "a1", title: "Welcome", body: "Office-wide note", audience_roles: [], published_at: nowIso, expires_at: null }],
  courseCategories: [], partnerCenters: [{ id: "pc1", name: "Partner Center A", active: true }],
  requests: [{ id: "r1", request_number: "REQ-0001", request_type: "Rescheduling", requested_values: null, reason: "Vessel schedule moved", status: "Pending", created_at: nowIso, trainees: { legal_first_name: "Maria", legal_last_name: "Reyes" }, enrollments: { enrollment_number: "ENR-0001", courses: { name: "Ship Security Officers" } } }],
  // "medical_certificate" is a legacy tick that counts as the PEME medical.
  requirementChecks: ["valid_id", "seamans_book", "medical_certificate", "photo_2x2"].map((requirement) => ({ enrollment_id: "e4", requirement, status: "Verified", remarks: null, checked_at: nowIso, checked_by_name: "Reg Officer" })),
  awaitingCourseIds: ["t3"],
  applicationNumbers: { t3: "NWMTACI-0000003", t1: "NWMTACI-0000001" },
  instructionsCount: { e1: 2 },
  pendingCharges: [], employeeCharges: [], chargeEmployees: [], instructionTemplates: [], batchStaffing: [], myHr: null,
} as unknown as PortalData;

const noop = () => undefined;
const reload = async () => undefined;

describe("Registration Officer workspace", () => {
  it("renders the two-box dashboard: new registrations and enrollments by day", () => {
    const html = renderToString(createElement(RegistrationDashboard, { data: fixture, go: noop }));
    for (const title of ["New registrations", "Enrollments", "Search trainee", "Screen applications"]) expect(html).toContain(title);
    // New Registrations: applicants not yet enrolled (and the one without a course).
    const box = html.slice(html.indexOf('id="rd-new"'), html.indexOf('id="rd-enrolled"'));
    expect(box).toContain("Juan Santos");
    expect(box).toContain("No course yet");
    expect(box).not.toContain("ENR-0001");
    // Enrollments: today by default, so ENR-0001 (enrolled today) and not ENR-0006 (January).
    const enrolled = html.slice(html.indexOf('id="rd-enrolled"'));
    expect(enrolled).toContain("Maria Reyes");
    expect(enrolled).not.toContain("Pedro Cruz");
    expect(enrolled).toContain('type="date"');
    expect(html).not.toContain("Register a trainee");
  });

  it("lets an application be paid before it has a batch, enrolling once the batch is chosen", () => {
    const e4 = fixture.enrollments.find((e) => e.id === "e4")!;
    const unplaced = applicationReadiness({ ...e4, batch_id: null, batches: null }, fixture.requirementChecks ?? [], "2026-10-07T03:00:00Z");
    expect(unplaced.missing).toHaveLength(0);
    expect(unplaced.paid).toBe(true);
    expect(unplaced.ready).toBe(false);
    expect(unplaced.reason).toMatch(/choose a batch/);
  });

  it("tracks the hand-over to the Cashier", () => {
    const e5 = fixture.enrollments.find((e) => e.id === "e5")!;
    expect(applicationReadiness(e5, [], "2026-10-07T03:00:00Z").handed).toBe(true);
    expect(applicationReadiness(e5, []).handed).toBe(false);
  });

  it("works out whether an application is ready to enroll", () => {
    const [e4, e5] = ["e4", "e5"].map((id) => fixture.enrollments.find((e) => e.id === id)!);
    const ready = applicationReadiness(e4, fixture.requirementChecks ?? []);
    expect(ready.ready).toBe(true);
    const blocked = applicationReadiness(e5, fixture.requirementChecks ?? []);
    expect(blocked.ready).toBe(false);
    expect(blocked.missing).toHaveLength(4);
    // An optional "other" line never blocks.
    expect(applicationReadiness(e4, [...(fixture.requirementChecks ?? []), { enrollment_id: "e4", requirement: "other", status: "Rejected", remarks: "x", checked_at: nowIso, checked_by_name: null }]).ready).toBe(true);
    // Without the 2x2 photo the application is not complete.
    expect(applicationReadiness(e4, (fixture.requirementChecks ?? []).filter((c) => c.requirement !== "photo_2x2")).missing).toEqual(["2x2 Photo"]);
    expect(blocked.reason).toMatch(/^Not verified yet/);
    const unpaid = applicationReadiness({ ...e4, verified_paid_centavos: 0 }, fixture.requirementChecks ?? []);
    expect(unpaid.reason).toBe("No verified payment yet");
  });

  it("lists every enrollment under three tabs: All Enrollments, Screening, For Payment", () => {
    const props = { data: fixture, query: "", reload, setView: noop, trainees: createElement("p", null, "TRAINEE-LIST") };
    const apps = renderToString(createElement(RegistrationRecords, { ...props, view: "applications" }));
    expect(apps).toContain("ENR-0004");
    expect(apps).toContain("ENR-0005");
    expect(apps).not.toContain("ENR-0001"); // Screening tab: enrolled trainees are not listed
    expect(apps).toContain("Paid · Enrolling");
    for (const tab of ["All enrollments", "Screening", "For payment"]) expect(apps).toContain(tab);
    for (const gone of ["Ready to enroll", "With Cashier", "No course yet<small>"]) expect(apps).not.toContain(gone);
    expect(apps).not.toContain("Register a trainee");
    // A website applicant without a course waits for Registration to assign one.
    expect(apps).toContain("No course yet");
    expect(apps).toContain("Pedro Cruz");
    expect(apps).toContain("Assign course");
    // Staff find applications by the NWMTACI number applicants quote on Facebook.
    expect(apps).toContain("NWMTACI-0000003");
    expect(apps).toContain("NWMTACI-0000001");
    const enrolls = renderToString(createElement(RegistrationRecords, { ...props, view: "enrollments" }));
    expect(enrolls).toContain("ENR-0001");
    expect(enrolls).toContain("Open Schedule");
    expect(enrolls).toContain("ENR-0004"); // All enrollments includes applications
    expect(enrolls).toContain("Partially Paid");
    expect(enrolls).not.toContain("Record payment");
    expect(renderToString(createElement(RegistrationRecords, { ...props, view: "trainees" }))).toContain("TRAINEE-LIST");
  });

  it("shows the website courses with seats left, and no rebate or partner-payable figures", () => {
    const html = renderToString(createElement(CoursesAndCenters, { data: fixture, query: "" }));
    expect(html).toContain("Crowd Management Training");
    expect(html).toContain("3 of 24 left");
    for (const tab of ["STCW schedules", "In-House courses", "Endorsed programs"]) expect(html).toContain(tab);
    expect(html).not.toContain("rebate");
    expect(html).not.toContain("payable");
  });

  it("can only send the actions the role is allowed (MASTERPLAN §10: never a payment write)", () => {
    const source = readFileSync(new URL("../components/portal/live-registration.tsx", import.meta.url), "utf8");
    // Sent directly from the Registration screens.
    const direct = new Set([...source.matchAll(/action: ?"([a-z-]+)"/g)].map((m) => m[1]));
    expect([...direct].sort()).toEqual(["application-assign", "application-enroll", "application-handover", "application-place-batch", "requirement-check", "send-instructions"]);
    // The Training Admission Record is printed by the Cashier, never from here.
    expect(source).not.toContain("admission-record-issue");
    expect(source).not.toContain("openAdmissionRecord");
    expect(source).not.toContain("Print admission record");
    // The only shared action component it may pull in is the request modal,
    // whose single action is request-raise. Payment, charge and discount
    // modals live in the same file and must never be imported here.
    const imported = source.match(/import \{([^}]+)\} from "\.\/payment-actions"/)?.[1] ?? "";
    const names = imported.split(",").map((s) => s.trim().replace(/^type /, "")).filter(Boolean).sort();
    expect(names).toEqual(["RequestActionModal", "RequestType"]);
    for (const forbidden of ["create-enrollment", "post-payment", "payment-split", "enrollment-charge", "enrollment-reschedule", "enrollment-course-change", "enrollment-delete", "record-agency-rebate", "discount-request", "PaymentForm", "PaymentHubModal", "ChargeActionModal", "DiscountRequestModal", "SplitActionModal"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
