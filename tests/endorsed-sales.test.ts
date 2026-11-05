import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { centerStateOf, endorsedRange, endorsedSales, rebateStateOf, type EndorsedRow } from "@/lib/endorsed-sales";
import { summarize } from "@/lib/finance-summary";

const row = (over: Partial<EndorsedRow>): EndorsedRow => ({
  id: "e", trainee: "DELA CRUZ, Juan P.", traineeNo: "NWMTACI-0000001", enrollmentNo: "ENR-1", status: "Enrolled", center: "Nautical Options", code: "BT", course: "Basic Training", trainingDate: "2026-11-05",
  fee: 550000, collected: 550000, balance: 0, payable: 550000, centerPaid: 0, centerState: "Owed", rebate: 130000, rebateReceived: 0, rebateState: "Due", share: 100000, keeps: 30000, ...over,
});

describe("Sales from Endorsed Courses", () => {
  const rows = [
    row({ id: "a" }),
    row({ id: "b", trainee: "REYES, Maria L.", trainingDate: "2026-11-03", fee: 480000, collected: 240000, balance: 240000, payable: 480000, centerPaid: 480000, centerState: "Paid", rebate: 90000, rebateReceived: 90000, rebateState: "Received", share: 0, keeps: 90000 }),
    row({ id: "c", center: "Mariana", code: "RASE", fee: 700000, collected: 700000, payable: 700000, rebate: 150000, share: 80000, keeps: 70000 }),
  ];
  it("groups by center, largest sales first, newest training first", () => {
    const s = endorsedSales(rows);
    expect(s.centers.map((c) => c.name)).toEqual(["Nautical Options", "Mariana"]);
    expect(s.centers[0].rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("adds up each center and the grand total", () => {
    const s = endorsedSales(rows);
    expect(s.centers[0].totals).toMatchObject({ trainees: 2, fees: 1030000, collected: 790000, balance: 240000, centerPaid: 480000, centerOwed: 550000, rebate: 220000, rebateReceived: 90000, rebateDue: 130000, share: 100000, keeps: 120000 });
    expect(s.totals).toMatchObject({ trainees: 3, fees: 1730000, rebate: 370000, share: 180000, keeps: 190000 });
  });
  it("agrees with the Cash and Sales Summary for the same trainees", () => {
    const s = endorsedSales(rows);
    const e = summarize({ payments: [], income: [], expenses: [], sales: rows.map((r) => ({ endorsement: true, code: r.code, name: r.course, center: r.center, price: r.fee, payable: r.payable, rebate: r.rebate, share: r.share, charges: 0, discounts: 0, collected: r.collected, rebateReceived: r.rebateReceived })) }).endorsement;
    expect({ trainees: e.trainees, fees: e.fees, payable: e.payable, rebate: e.rebate, received: e.received, share: e.share, keeps: e.keeps, rebateDue: e.rebateDue }).toEqual({ trainees: s.totals.trainees, fees: s.totals.fees, payable: s.totals.payable, rebate: s.totals.rebate, received: s.totals.rebateReceived, share: s.totals.share, keeps: s.totals.keeps, rebateDue: s.totals.rebateDue });
    expect(e.centers.map((c) => [c.name, c.fees, c.keeps])).toEqual(s.centers.map((c) => [c.name, c.totals.fees, c.totals.keeps]));
  });
  it("reads the center and rebate states as Pay the Centers and Other Income do", () => {
    expect([centerStateOf("Paid"), centerStateOf("Approved"), centerStateOf("Pending"), centerStateOf("Rejected"), centerStateOf(null)]).toEqual(["Paid", "Approved", "For Approval", "Owed", "Owed"]);
    expect([rebateStateOf(0, 0), rebateStateOf(100, 0), rebateStateOf(100, 100)]).toEqual(["None", "Due", "Received"]);
  });
  it("takes a period or a custom range and refuses anything else", () => {
    const ask = (q: string) => endorsedRange(new URLSearchParams(q));
    expect(ask("period=Monthly&end=2026-11-05")).toMatchObject({ from: "2026-11-01", to: "2026-11-05" });
    expect(ask("from=2026-10-01&to=2026-11-05")).toEqual({ from: "2026-10-01", to: "2026-11-05", title: "Custom Range" });
    for (const bad of ["", "period=Monthly", "period=Hourly&end=2026-11-05", "from=2026-11-05&to=2026-10-01", "from=2026-10-01", "from=x&to=y"]) expect(ask(bad)).toBeNull();
  });
  it("keeps the report from the Cashier and other roles", () => {
    for (const file of ["app/api/staff/endorsed-sales/route.ts", "app/api/documents/endorsed-sales/route.ts"]) expect(readFileSync(file, "utf8")).toContain('["admin", "accounting"].includes(role)');
  });
});
