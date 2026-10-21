import { describe, expect, it } from "vitest";
import { COPY_COLUMNS, traineeCopy } from "@/lib/trainee-copy";

describe("copy trainee details", () => {
  const t = { name: "DELA CRUZ, Juan P.", nwmtaciNo: "NWMTACI-2026-0430", birthDate: "Mar 14, 1996", placeOfBirth: "Iloilo City", srn: "2219334881", rank: "Able Seaman", company: "", address: "Blk 4\tLot 12\nPasay", mobile: "09175550142", email: "juan@example.com", emergency: "Maria Dela Cruz · 09185550199", courses: [{ course: "BT Basic Training", center: "Nautical Options", date: "Oct 27, 2026" }, { course: "SSO", center: "Altitude Maritime", date: "Nov 3, 2026" }] };
  it("writes labelled lines, leaving out empty fields", () => {
    const { text } = traineeCopy(t);
    expect(text).toContain("Full Name: DELA CRUZ, Juan P.");
    expect(text).not.toContain("Company:");
    expect(text).toContain("Address: Blk 4 Lot 12 Pasay");
    expect(text).toContain("Course 2: SSO · Altitude Maritime · Nov 3, 2026");
  });
  it("writes one tab-separated row per course with every column", () => {
    const rows = traineeCopy(t).rows.split("\n");
    expect(rows).toHaveLength(2);
    expect(rows[0].split("\t")).toHaveLength(COPY_COLUMNS.length);
    expect(rows[1].split("\t").slice(-3)).toEqual(["SSO", "Altitude Maritime", "Nov 3, 2026"]);
  });
});
