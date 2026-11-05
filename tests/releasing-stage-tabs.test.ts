import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PortalData } from "@/components/portal-live-app";
import { ReleasingCertificates, certificateLines } from "@/components/portal/releasing-home";

const course = { id: "c1", name: "Anti Piracy Awareness", code: "APA", delivery_type: "In-House", duration_label: "1 Day", course_categories: { name: "Maritime In-House" } };
const enrollment = (id: string, last: string, paid: number, extra: Record<string, unknown> = {}) => ({
  id, enrollment_number: `ENR-${id}`, enrollment_status: "Enrolled", course_id: "c1", trainee_id: `t-${id}`, scheduled_on: "2026-10-01", created_at: "2026-10-01T00:00:00Z",
  selling_price_centavos: 130000, charges_centavos: 0, discounts_centavos: 0, paid_centavos: paid, partner_offer_id: null, batches: null, courses: course,
  trainees: { legal_first_name: "Juan", legal_last_name: last, trainee_number: `NWM-${id}` }, ...extra,
});
const data = (over: Record<string, unknown> = {}) => ({
  courses: [course], payments: [], certificates: [], certificateReleases: [], deliveryRequests: [], applicationNumbers: {}, feedbackAt: { paid: "2026-10-02T00:00:00Z", initial: "2026-10-02T00:00:00Z", billed: "2026-10-02T00:00:00Z" },
  certificatePhotos: [{ enrollment_id: "paid", file_name: "a.jpg" }, { enrollment_id: "initial", file_name: "b.jpg" }, { enrollment_id: "billed", file_name: "c.jpg" }],
  companyCharge: { billed: "agency-1" },
  enrollments: [enrollment("paid", "PAID", 130000), enrollment("initial", "INITIAL", 65000), enrollment("billed", "BILLED", 0), enrollment("none", "NOPAY", 0)],
  ...over,
}) as unknown as PortalData;
const render = (d: PortalData) => renderToStaticMarkup(createElement(ReleasingCertificates, { data: d, reload: async () => undefined }));

describe("Releasing Officer · Stage Tabs", () => {
  it("leaves out a trainee with no payment, unless on Company Charge", () => {
    const names = certificateLines(data()).map((l) => l.name.split(",")[0]);
    expect(names).toEqual(expect.arrayContaining(["PAID", "INITIAL", "BILLED"]));
    expect(names).not.toContain("NOPAY");
  });
  it("opens on To Print, with the balance shown and no Certificate No. column", () => {
    const html = render(data());
    for (const tab of ["Waiting", "To Print", "To Release", "Released"]) expect(html).toContain(`<span>${tab}</span>`);
    expect(html).toContain("PAID");
    expect(html).toContain("INITIAL");
    expect(html).toContain("BILLED");
    expect(html).not.toContain("NOPAY");
    expect(html).toContain("Balance ₱650.00");
    expect(html).toContain("Company Charge");
    expect(html).not.toContain("Certificate No.</th>");
    expect(html).toContain(">Print</a>");
  });
  it("takes a printed certificate off To Print by itself", () => {
    const html = render(data({ certificates: [{ id: "x", enrollment_id: "paid", status: "Printed", print_count: 1, reprints_allowed: 0, certificate_number: "NWMTACI-APA2026000001" }] }));
    expect(html).not.toContain("PAID");
    expect(html).toContain("INITIAL");
  });
});
