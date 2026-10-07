import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { PortalData } from "@/components/portal-live-app";
import { CoursesAndCenters, RegistrationDashboard, RegistrationEnrollments, RegistrationIntake } from "@/components/portal/live-registration";

/**
 * Registration Officer workspace: renders every screen against a fixture and
 * pins the role boundary from MASTERPLAN §10 — this role reads payment status
 * but can never write a payment, charge, reschedule, or deletion.
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
    { id: "c3", code: "END", name: "Endorsed Program", delivery_type: "Partner or Endorsed", duration_label: "2 days", standard_price_centavos: 0, course_categories: null },
  ],
  offers: [{ id: "o1", course_id: "c3", duration_label: "2 days", training_fee_centavos: 800000, rebate_centavos: 50000, partner_payable_centavos: 750000, partner_centers: { name: "Partner Center A" } }],
  trainees: [
    { id: "t1", trainee_number: "NW-0001", legal_first_name: "Maria", legal_last_name: "Reyes", birthdate: "1990-01-01", email: "maria@example.test", mobile: "+639171234567", srn: "1234567890", account_state: "Active", registered_at: nowIso },
    { id: "t2", trainee_number: "NW-0002", legal_first_name: "Juan", legal_last_name: "Santos", birthdate: "1992-02-02", email: "juan@example.test", mobile: "+639181234567", srn: null, account_state: "Active", registered_at: nowIso },
  ],
  batches: [
    { id: "b1", batch_number: "SSO-2610", course_id: "c1", partner_offer_id: null, starts_on: plus(5), ends_on: plus(7), mode: "Face-to-face", venue: "Room 1", capacity: 24, confirmed_count: 3, enrollment_deadline: `${plus(4)}T23:59:59+08:00`, status: "Open", published_at: nowIso, courses: { name: "Ship Security Officers", code: "SSO" } },
    { id: "b2", batch_number: "SSO-FULL", course_id: "c1", partner_offer_id: null, starts_on: plus(9), ends_on: plus(11), mode: "Face-to-face", venue: null, capacity: 24, confirmed_count: 24, enrollment_deadline: `${plus(8)}T23:59:59+08:00`, status: "Full", published_at: nowIso, courses: { name: "Ship Security Officers", code: "SSO" } },
  ],
  enrollments: [
    { id: "e1", enrollment_number: "ENR-0001", trainee_id: "t1", course_id: "c1", partner_offer_id: null, batch_id: "b1", enrollment_status: "Enrolled", selling_price_centavos: 450000, rebate_centavos: 0, partner_payable_centavos: 0, paid_centavos: 200000, charges_centavos: 0, discounts_centavos: 0, created_at: nowIso, source: "Public registration", trainees: { trainee_number: "NW-0001", legal_first_name: "Maria", legal_last_name: "Reyes", email: "maria@example.test", mobile: "+639171234567" }, courses: { name: "Ship Security Officers", code: "SSO" }, batches: { batch_number: "SSO-2610", starts_on: plus(5), ends_on: plus(7), mode: "Face-to-face", venue: "Room 1" } },
    { id: "e2", enrollment_number: "ENR-0002", trainee_id: "t2", course_id: "c2", partner_offer_id: null, batch_id: null, enrollment_status: "Open Schedule", selling_price_centavos: 150000, rebate_centavos: 0, partner_payable_centavos: 0, paid_centavos: 0, created_at: nowIso, source: "Staff-assisted registration", trainees: { trainee_number: "NW-0002", legal_first_name: "Juan", legal_last_name: "Santos", email: "juan@example.test", mobile: "+639181234567" }, courses: { name: "Awareness on Basic Computer", code: "ABC" }, batches: null },
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
  pendingCharges: [], employeeCharges: [], chargeEmployees: [], instructionTemplates: [], batchStaffing: [], myHr: null,
} as unknown as PortalData;

const noop = () => undefined;
const reload = async () => undefined;

describe("Registration Officer workspace", () => {
  it("renders the dashboard with the masterplan's cards and no payment cards", () => {
    const html = renderToString(createElement(RegistrationDashboard, { data: fixture, go: noop, openEnrollment: noop }));
    for (const card of ["New registrations today", "Pending enrollments", "Open schedule", "Upcoming trainees", "Recently enrolled", "Cancelled", "Pending requests", "Slips not yet generated"]) {
      expect(html).toContain(card);
    }
    // MASTERPLAN §10: Unpaid / Partially Paid summary cards belong to the Cashier.
    expect(html).not.toMatch(/<span>(Unpaid|Partially paid) enrollments<\/span>/);
    expect(html).toContain("Public registrations today");
    expect(html).toContain("Welcome");
  });

  it("renders the intake wizard at step one with every public-form field", () => {
    const html = renderToString(createElement(RegistrationIntake, { data: fixture, reload, go: noop }));
    expect(html).toContain("Register a trainee");
    for (const label of ["First name", "Last name", "Suffix", "SRN (10 digits)", "Email", "Present address", "Contact number", "Place of birth", "Date of birth", "Rank", "Company / manning agency", "Emergency contact person", "Emergency contact number"]) {
      expect(html).toContain(label);
    }
  });

  it("lists enrollments with status and read-only payment state", () => {
    const html = renderToString(createElement(RegistrationEnrollments, { data: fixture, query: "", reload, go: noop }));
    expect(html).toContain("ENR-0001");
    expect(html).toContain("ENR-0002");
    expect(html).toContain("Open Schedule");
    expect(html).toContain("Partially paid");
    expect(html).not.toContain("Record payment");
  });

  it("shows courses and centers without rebate or partner-payable figures", () => {
    const html = renderToString(createElement(CoursesAndCenters, { data: fixture, query: "" }));
    expect(html).toContain("SSO");
    expect(html).toContain("Partner Center A");
    expect(html).not.toContain("rebate");
    expect(html).not.toContain("payable");
  });

  it("can only send the actions the role is allowed (MASTERPLAN §10: never a payment write)", () => {
    const source = readFileSync(new URL("../components/portal/live-registration.tsx", import.meta.url), "utf8");
    // Sent directly from the Registration screens.
    const direct = new Set([...source.matchAll(/action: ?"([a-z-]+)"/g)].map((m) => m[1]));
    expect([...direct].sort()).toEqual(["create-enrollment", "send-instructions"]);
    // The only shared action component it may pull in is the request modal,
    // whose single action is request-raise. Payment, charge and discount
    // modals live in the same file and must never be imported here.
    const imported = source.match(/import \{([^}]+)\} from "\.\/payment-actions"/)?.[1] ?? "";
    const names = imported.split(",").map((s) => s.trim().replace(/^type /, "")).filter(Boolean).sort();
    expect(names).toEqual(["RequestActionModal", "RequestType"]);
    for (const forbidden of ["post-payment", "payment-split", "enrollment-charge", "enrollment-reschedule", "enrollment-course-change", "enrollment-delete", "record-agency-rebate", "discount-request", "PaymentForm", "PaymentHubModal", "ChargeActionModal", "DiscountRequestModal", "SplitActionModal"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
