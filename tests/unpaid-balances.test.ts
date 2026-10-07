import { describe, expect, it } from "vitest";
import { unpaidAfterTraining, type BalanceEnrollment } from "@/lib/unpaid-balances";

const base = { trainee_id: "t1", course_id: "c1", selling_price_centavos: 160000, paid_centavos: 0, trainees: { legal_first_name: "Juan", legal_last_name: "Santos" }, courses: { name: "Crowd Management Training", code: "PSCMT" } };
const row = (id: string, extra: Partial<BalanceEnrollment>): BalanceEnrollment => ({ id, enrollment_number: id.toUpperCase(), enrollment_status: "Enrolled", ...base, ...extra });
const durations = (id: string) => (id === "c2" ? "3 days" : "2 days");

describe("Unpaid balances after training (Cashier dashboard and 4:00 PM email)", () => {
  const today = "2026-10-14";
  const rows = unpaidAfterTraining([
    row("e1", { batches: { ends_on: "2026-10-14" } }), // ends today, unpaid
    row("e2", { batches: { ends_on: "2026-10-10" }, paid_centavos: 80000 }), // ended, partly paid
    row("e3", { batches: { ends_on: "2026-10-10" }, paid_centavos: 160000 }), // settled
    row("e4", { batches: { ends_on: "2026-10-20" } }), // not ended yet
    row("e5", { batches: { ends_on: "2026-10-01" }, enrollment_status: "Cancelled" }), // cancelled
    row("e6", { course_id: "c2", scheduled_on: "2026-10-08", batches: null }), // picked date + 3 days → ends Oct 10
    row("e7", { batches: { ends_on: "2026-10-09" }, charges_centavos: 35000, paid_centavos: 160000 }), // unpaid make-up charge
  ], durations, today);
  it("lists only trainees whose training ended or ends today and who still owe", () => {
    expect(rows.map((r) => r.id).sort()).toEqual(["e1", "e2", "e6", "e7"]);
  });
  it("flags today's endings and counts charges in the balance", () => {
    expect(rows.find((r) => r.id === "e1")?.endsToday).toBe(true);
    expect(rows.find((r) => r.id === "e2")?.balanceCentavos).toBe(80000);
    expect(rows.find((r) => r.id === "e6")?.trainingEnd).toBe("2026-10-10");
    expect(rows.find((r) => r.id === "e7")?.balanceCentavos).toBe(35000);
  });
});
