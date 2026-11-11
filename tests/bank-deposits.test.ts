import { describe, expect, it } from "vitest";
import { depositNumber, depositedOn, drawerExpected, nextStatus } from "@/lib/bank-deposits";

describe("bank deposits", () => {
  it("moves only along Requested → Deposited → Received, with Return and Cancel", () => {
    expect(nextStatus("Requested", "mark")).toBe("Deposited");
    expect(nextStatus("Deposited", "confirm")).toBe("Received");
    expect(nextStatus("Deposited", "return")).toBe("Returned");
    expect(nextStatus("Returned", "mark")).toBe("Deposited");
    expect(nextStatus("Requested", "cancel")).toBe("Cancelled");
    expect(nextStatus("Deposited", "cancel")).toBeNull();
    expect(nextStatus("Received", "return")).toBeNull();
    expect(nextStatus("Requested", "confirm")).toBeNull();
  });
  it("takes deposits out of the drawer, not out of expenses", () => {
    const deps = [
      { status: "Deposited" as const, deposited_on: "2026-11-11", amount_centavos: 3_000_000 },
      { status: "Received" as const, deposited_on: "2026-11-10", amount_centavos: 2_000_000 },
      { status: "Requested" as const, deposited_on: null, amount_centavos: 900_000 },
      { status: "Returned" as const, deposited_on: "2026-11-11", amount_centavos: 100_000 },
    ];
    expect(depositedOn(deps, "2026-11-11")).toBe(3_100_000);
    expect(drawerExpected({ opening: 500_000, cashIn: 4_825_000, cashExpenses: 235_000, deposits: 3_000_000 })).toBe(2_090_000);
  });
  it("numbers deposits NWM-DEP-YYYY-NNNN", () => {
    expect(depositNumber("DEP-2026-000007")).toBe("NWM-DEP-2026-0007");
  });
});
