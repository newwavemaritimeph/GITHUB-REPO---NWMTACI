import { describe, expect, it } from "vitest";
import { PRINTED_FILTERS, printedReportRows } from "../lib/printed-certificates";

const certs = [
  { id: "a", status: "Printed", printed_at: "2026-10-20T01:00:00Z", print_count: 1, certificate_number: "ABC-00150", registration_number: "NWMTC00412-102026", sticker_no: "HS-1", printer: { complete_name: "J. Ramos" } },
  { id: "b", status: "Printed", printed_at: "2026-10-20T02:00:00Z", print_count: 2, certificate_number: "HPT-00149", sticker_no: null },
  { id: "c", status: "Printed", printed_at: "2026-10-10T02:00:00Z", print_count: 1, revoked_at: "2026-10-12T00:00:00Z" },
  { id: "d", status: "Ready to Print", printed_at: null },
];
const who = (id: string) => (id === "a" ? { name: "ESGUERRA, Kate", number: "0412", course: "ABC", courseName: "Awareness on Basic Computer", balance: 0 } : id === "b" ? { name: "MENDOZA, Ana", number: "0288", course: "HPT", courseName: "Hazmat", balance: 50000 } : null);

describe("printed certificates report", () => {
  it("lists prints in the period with numbers, payment and release", () => {
    const rows = printedReportRows(certs, who, new Map([["a", "2026-10-20"]]), "2026-10-20", "2026-10-20", "2026-10-20");
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(rows[1]).toMatchObject({ regNo: "NWMTC00412-102026", docNo: "HS-1", printedBy: "J. Ramos", status: "Released", balance: 0 });
    expect(rows[0]).toMatchObject({ copy: 2, status: "Waiting", balance: 50000 });
    expect(rows.filter(PRINTED_FILTERS["With Balance"]).map((r) => r.id)).toEqual(["b"]);
    expect(rows.filter(PRINTED_FILTERS["No Document No."]).map((r) => r.id)).toEqual(["b"]);
    expect(rows.filter(PRINTED_FILTERS.Reprints).map((r) => r.id)).toEqual(["b"]);
  });
  it("marks revoked certificates and counts days since print", () => {
    const [r] = printedReportRows(certs, who, new Map(), "2026-10-01", "2026-10-31", "2026-10-20").filter((x) => x.id === "c");
    expect(r).toMatchObject({ status: "Revoked", ageDays: 10 });
    expect(PRINTED_FILTERS["No Document No."](r)).toBe(false);
  });
});
