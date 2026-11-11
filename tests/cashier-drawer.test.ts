import { describe, expect, it } from "vitest";
import { closingCheck, countedCentavos, isCash, isGcash } from "@/lib/cashier-drawer";

describe("opening and closing, Cash and GCash", () => {
  it("adds up the bill counter", () => {
    expect(countedCentavos({ 1000: 18, 500: 4, 200: 2, 100: 4, 50: 1, 20: 1, 10: 1 })).toBe(2_088_000);
    expect(countedCentavos({ 1000: -2, 1: 2.7 })).toBe(200);
  });
  it("works out expected and variance for each side", () => {
    const f = { openingCash: 500_000, cashIn: 4_825_000, cashExpenses: 235_000, deposits: 3_000_000, openingGcash: 1_245_050, gcashIn: 984_000, gcashExpenses: 265_000 };
    const c = closingCheck(f, 2_088_000, 1_964_050);
    expect(c.cash).toBe(2_090_000);
    expect(c.gcash).toBe(1_964_050);
    expect(c.cashVariance).toBe(-2_000);
    expect(c.gcashVariance).toBe(0);
    expect(c.needsRemarks).toBe(true);
    expect(closingCheck(f, 2_090_000, 1_964_050).needsRemarks).toBe(false);
  });
  it("tells Cash and GCash apart from bank channels", () => {
    expect([isCash(null), isCash("Cash"), isCash("GCash")]).toEqual([true, true, false]);
    expect([isGcash("GCash"), isGcash("G-Cash"), isGcash("PSBank")]).toEqual([true, true, false]);
  });
});
