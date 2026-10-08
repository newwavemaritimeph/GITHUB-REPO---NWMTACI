import { describe, expect, it } from "vitest";
import { requestFee } from "@/lib/request-fees";

const fee = (type: string, requestedOn: string, startDate: string | null = "2026-10-12", trainingFeeCentavos = 180000) => requestFee({ type, trainingFeeCentavos, startDate, requestedOn })?.amountCentavos;

describe("request fees", () => {
  it("rescheduling: ₱300 from 3 days before, 50% + ₱250 within 2 days", () => {
    expect(fee("Rescheduling", "2026-10-07")).toBe(30000); // 5 days
    expect(fee("Rescheduling", "2026-10-09")).toBe(30000); // 3 days
    expect(fee("Rescheduling", "2026-10-10")).toBe(115000); // 2 days
    expect(fee("Rescheduling", "2026-10-11")).toBe(115000); // 1 day
    expect(fee("Rescheduling", "2026-10-12")).toBe(115000); // start date
    expect(fee("Rescheduling", "2026-10-13")).toBe(115000); // after start
  });
  it("cancellation: ₱300 from 5 days before, 50% + ₱250 within 5 days", () => {
    expect(fee("Cancellation", "2026-10-06")).toBe(30000); // 6 days
    expect(fee("Cancellation", "2026-10-07")).toBe(30000); // 5 days
    expect(fee("Cancellation", "2026-10-08")).toBe(115000); // 4 days
    expect(fee("Cancellation", "2026-10-12")).toBe(115000); // start date
  });
  it("rounds half of an odd fee to the centavo and explains the rule", () => {
    const r = requestFee({ type: "Cancellation", trainingFeeCentavos: 180001, startDate: "2026-10-12", requestedOn: "2026-10-10" });
    expect(r?.amountCentavos).toBe(90001 + 25000);
    expect(r?.rule).toBe("2 days before the start: 50% of ₱1,800.01 + ₱250.00");
  });
  it("uses the flat fee when there is no training date, and no rule for other types", () => {
    expect(fee("Rescheduling", "2026-10-10", null)).toBe(30000);
    expect(requestFee({ type: "Change Course", trainingFeeCentavos: 180000, startDate: "2026-10-12", requestedOn: "2026-10-10" })).toBeNull();
  });
});
