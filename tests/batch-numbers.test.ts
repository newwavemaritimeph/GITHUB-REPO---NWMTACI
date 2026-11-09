import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PortalData } from "@/components/portal-live-app";
import { BatchNumbers, batchNumberOf, batchNumberProblem, firstFreeBatchNumber } from "@/components/portal/batch-numbers";
import { addDays, manilaToday } from "@/lib/portal-format";

const view = vi.hoisted(() => ({ upcoming: false }));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return { ...react, useState: (init: unknown) => react.useState(view.upcoming && init === "next" ? "up" : init) };
});

const year = Number(manilaToday().slice(0, 4)), yy = String(year % 100).padStart(2, "0"), today = manilaToday();
const course = (id: string, code: string, name: string) => ({ id, code, name, delivery_type: "In-House", duration_label: "1 Day" });
const batch = (id: string, courseId: string, no: string, start: string, extra: Record<string, unknown> = {}) => ({ id, course_id: courseId, batch_number: no, starts_on: start, ends_on: start, status: "Open", capacity: 24, confirmed_count: 2, mode: "In-person", enrollment_deadline: start, ...extra });
const data = {
  courses: [course("c1", "STPPDSPPS", "Safety Training"), course("c2", "PSCMT", "Crowd Management"), course("c3", "APA", "Anti Piracy Awareness")],
  batchNumberSeries: [{ course_id: "c1", middle: "506", series_year: year, next_number: 23 }, { course_id: "c2", middle: "507", series_year: year - 1, next_number: 300 }],
  batches: [batch("b1", "c1", `${yy}-506-023`, today), batch("b2", "c1", `${yy}-506-024`, addDays(today, 7)), batch("b3", "c3", "BCH-2026-000141", addDays(today, 1)), batch("b4", "c3", "BCH-2026-000099", addDays(today, -30), { ends_on: addDays(today, -30) }), batch("b5", "c3", "PARTNER-1", addDays(today, 2), { partner_offer_id: "p1" })],
} as unknown as PortalData;
const render = () => renderToStaticMarkup(createElement(BatchNumbers, { data, reload: async () => undefined }));

describe("Batch numbers", () => {
  it("formats and skips numbers already used, like next_batch_number", () => {
    expect(batchNumberOf(2026, "506", 24)).toBe("26-506-024");
    expect(firstFreeBatchNumber(2026, "506", 23, new Set(["26-506-023", "26-506-024", "26-506-026"]))).toBe("26-506-025");
  });
  it("checks a typed batch number", () => {
    expect(batchNumberProblem("")).toBe("Enter a batch number.");
    expect(batchNumberProblem("26 506")).toBe("Use letters, digits and dashes.");
    expect(batchNumberProblem("26-506-023", { starts_on: "2026-11-09" } as never, "STPPDSPPS")).toBe("Already used by STPPDSPPS · Nov 9.");
    expect(batchNumberProblem("26-506-030")).toBeNull();
  });
  it("Next Number shows each counter, the clash, and a counter from last year restarting at 001", () => {
    view.upcoming = false;
    const html = render();
    expect(html).toContain("Batch Numbers");
    expect(html).toContain(`${yy}-506-023`);
    expect(html).toContain(`next batch takes ${yy}-506-025`);
    expect(html).toContain(`${yy}-507-001`);
    expect(html).toContain("Add a Course");
    expect(html).toContain("numbered automatically (BCH)");
  });
  it("Upcoming Batches lists this month's own batches, not past or partner ones", () => {
    view.upcoming = true;
    const html = render();
    view.upcoming = false;
    expect(html).toContain(`value="${yy}-506-023"`);
    expect(html).not.toContain("BCH-2026-000099");
    expect(html).not.toContain("PARTNER-1");
    expect(html).toContain("Search batch number or course");
  });
});
