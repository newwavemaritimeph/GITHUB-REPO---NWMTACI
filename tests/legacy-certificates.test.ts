import { describe, expect, it } from "vitest";
import { isoDate, legacyRowsFromCsv, parseCsv } from "@/lib/legacy-certificates";

describe("certificate log spreadsheet", () => {
  it("reads quoted names with commas", () => {
    expect(parseCsv('Trainee,Course\r\n"DELA CRUZ, Juan",FSH\n')).toEqual([["Trainee", "Course"], ["DELA CRUZ, Juan", "FSH"]]);
  });
  it("maps columns by their headers and normalises dates", () => {
    const csv = 'Trainee Name,NWMTACI No.,Course Code,Certificate No.,Registration No.,Doc. No.,Date Issued\n"REYES, Paolo",,FSH,FSH000055,NWMTC007548-092026,00006883,9/30/2026\n';
    const { rows, missing } = legacyRowsFromCsv(csv);
    expect(missing).toEqual([]);
    expect(rows).toEqual([{ traineeName: "REYES, Paolo", nwmtaciNumber: "", courseCode: "FSH", certificateNumber: "FSH000055", registrationNumber: "NWMTC007548-092026", docNumber: "00006883", issuedOn: "2026-09-30" }]);
  });
  it("names missing columns", () => {
    expect(legacyRowsFromCsv("Certificate No.\nFSH000001\n").missing).toEqual(["Trainee", "Course"]);
  });
  it("accepts ISO and slash dates", () => {
    expect(isoDate("2026-09-30")).toBe("2026-09-30");
    expect(isoDate("10/2/2026")).toBe("2026-10-02");
    expect(isoDate("")).toBe("");
  });
});
