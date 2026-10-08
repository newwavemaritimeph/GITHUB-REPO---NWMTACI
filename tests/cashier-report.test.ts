import { describe, expect, it } from "vitest";
import { cashPosition, collectionsBySource, type CollectionRow } from "@/lib/cashier-report";

const row = (kind: CollectionRow["kind"], agency: string, channel: string, amount: number): CollectionRow => ({ receipt: "AR", time: "8:00 AM", trainee: "T", course: "C", channel, reference: "", amountCentavos: amount, kind, agency });

describe("cashier summary report", () => {
  it("splits collections into walk-ins, agencies and consultancies per channel", () => {
    const { channels, matrix, groups } = collectionsBySource([
      row("Direct walk-in", "", "Cash", 180000), row("Direct walk-in", "", "GCash", 150000),
      row("Agency", "Magsaysay", "UnionBank", 450000), row("Agency", "Alpha", "Cash", 150000),
      row("Consultancy", "Bluewave", "GCash", 250000),
    ], ["Cash", "GCash", "PSBank", "UnionBank"]);
    expect(channels).toEqual(["Cash", "GCash", "PSBank", "UnionBank"]);
    expect(matrix.map((m) => [m.source, m.count, m.totalCentavos])).toEqual([["Direct walk-ins", 2, 330000], ["Agencies", 2, 600000], ["Consultancies", 1, 250000]]);
    expect(matrix[1].cells.find((c) => c.channel === "UnionBank")).toEqual({ channel: "UnionBank", count: 1, totalCentavos: 450000 });
    expect(groups.map((g) => `${g.kind}:${g.name}:${g.subtotalCentavos}`)).toEqual(["Direct walk-in::330000", "Agency:Alpha:150000", "Agency:Magsaysay:450000", "Consultancy:Bluewave:250000"]);
  });
  it("adds today's cash to the previous cash, less cash expenses, and compares with the count", () => {
    expect(cashPosition({ previousCentavos: 1500000, cashCollectedCentavos: 580000, cashExpensesCentavos: 168500, countedCentavos: 1909500 })).toMatchObject({ onHandCentavos: 1911500, overShortCentavos: -2000 });
    expect(cashPosition({ previousCentavos: 0, cashCollectedCentavos: 100, cashExpensesCentavos: 0, countedCentavos: null }).overShortCentavos).toBeNull();
  });
});
