import { describe, expect, it } from "vitest";
import { centerLines } from "../components/portal/pay-centers";
import type { PortalData } from "../components/portal-live-app";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const center = { partner_centers: { name: "Nautical Options" } };
const enrollment = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, enrollment_number: `ENR-${id}`, trainee_id: "t", course_id: "c", partner_offer_id: "o1", enrollment_status: status, selling_price_centavos: 550000, rebate_centavos: 130000, partner_payable_centavos: 550000, paid_centavos: 550000, created_at: `${today}T01:00:00Z`, enrolled_at: `${today}T02:00:00Z`, partner_course_offers: center, courses: { code: "BT", name: "Basic Training" }, ...extra });
const data = (centerPayments: unknown[]) => ({
  offers: [{ id: "o1", course_id: "c", partner_center_id: "ctr1" }],
  enrollments: [enrollment("a", "Enrolled"), enrollment("b", "Enrolled"), enrollment("c", "Pending"), enrollment("d", "Enrolled", { partner_offer_id: null })],
  centerPayments,
}) as unknown as PortalData;

describe("paying the partnered centers", () => {
  it("lists enrolled Other STCW trainees as due today, with the full fee", () => {
    const lines = centerLines(data([]));
    expect(lines.map((l) => l.e.id)).toEqual(["a", "b"]);
    expect(lines[0]).toMatchObject({ state: "Due", dueToday: true, amount: 550000, center: "Nautical Options", centerId: "ctr1" });
  });
  it("follows the payment request: for approval, approved, paid; a rejected one is due again", () => {
    const lines = centerLines(data([
      { enrollment_id: "a", amount_centavos: 550000, expense_id: "x1", expenses: { status: "Pending", expense_number: "ER-1" } },
      { enrollment_id: "b", amount_centavos: 550000, expense_id: "x2", expenses: { status: "Rejected" } },
    ]));
    expect(lines.find((l) => l.e.id === "a")?.state).toBe("For Approval");
    expect(lines.find((l) => l.e.id === "b")?.state).toBe("Due");
    expect(centerLines(data([{ enrollment_id: "a", amount_centavos: 1, expense_id: "x1", expenses: { status: "Paid" } }])).find((l) => l.e.id === "a")?.state).toBe("Paid");
  });
});
