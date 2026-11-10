import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PortalData } from "@/components/portal-live-app";
import { TraineeContactCard } from "@/components/portal/releasing-home";

// Two trainees: one whose Meta thread Registration recorded, one without; the first has an LBC delivery.
const data = {
  enrollments: [
    { id: "e1", enrollment_number: "ENR-1", trainee_id: "t1", course_id: "c1", enrollment_status: "Enrolled" },
    { id: "e2", enrollment_number: "ENR-2", trainee_id: "t2", course_id: "c1", enrollment_status: "Enrolled" },
  ],
  trainees: [
    { id: "t1", trainee_number: "NWM-1", legal_first_name: "Juan", legal_last_name: "Dela Cruz", email: "juan@example.test", mobile: "09170000001" },
    { id: "t2", trainee_number: "NWM-2", legal_first_name: "Maria", legal_last_name: "Santos", email: "maria@example.test", mobile: "09170000002" },
  ],
  courses: [{ id: "c1", code: "UBT-PSSR", name: "Updating Course on Basic Training" }],
  certificates: [{ id: "k1", enrollment_id: "e1", status: "Printed", certificate_number: "UBT-2026-0007" }],
  applicationNumbers: { t1: "NWMTACI-0000031" },
  traineeFacebook: { t1: "https://business.facebook.com/latest/inbox/all?selected_item_id=123" },
  deliveryRequests: [{ id: "d1", enrollment_id: "e1", trainee_id: "t1", status: "Paid", address_line: "12 Sample St.", city: "Quezon City", province: "Metro Manila", zip: "1100" }],
} as unknown as PortalData;
const card = (enrollmentId: string) => renderToStaticMarkup(createElement(TraineeContactCard, { data, enrollmentId, onClose: () => undefined }));

describe("Releasing Officer's trainee contact card (owner, 10 Nov 2026, Design 3)", () => {
  it("opens the Meta thread Registration recorded, with the mobile, email and LBC address", () => {
    const html = card("e1");
    for (const s of ["DELA CRUZ, Juan", "NWMTACI-0000031", "UBT-2026-0007", "09170000001", "juan@example.test", "Open Conversation", "12 Sample St., Quezon City, Metro Manila, 1100"]) expect(html).toContain(s);
    expect(html).toContain('href="https://business.facebook.com/latest/inbox/all?selected_item_id=123"');
    expect(html).toContain('target="_blank"');
  });
  it("says when Registration has not recorded a thread yet", () => {
    const html = card("e2");
    expect(html).toContain("Not yet recorded");
    expect(html).not.toContain("Open Conversation");
    expect(html).not.toContain("Deliver To");
  });
  it("stays read-only: the Releasing Officer's screens never change the link", () => {
    for (const f of ["components/portal/releasing-home.tsx", "components/portal/live-releasing.tsx"]) expect(readFileSync(f, "utf8")).not.toContain("trainee-facebook");
  });
});
