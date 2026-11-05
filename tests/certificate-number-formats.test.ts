import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { formatNumber, formatProblem } from "@/lib/certificate-rules";

const nov = new Date("2026-11-05T02:00:00Z");

describe("certificate number formats", () => {
  it("fills every token, in Manila time", () => {
    expect(formatNumber("NWMTACI-{CODE}{YYYY}{N:6}", "ubt-pssr", 1, nov)).toBe("NWMTACI-UBT-PSSR2026000001");
    expect(formatNumber("NWMTC{N:6}-{MM}{YYYY}", "", 7550, nov)).toBe("NWMTC007550-112026");
    expect(formatNumber("NWMTC{M}{YYYY}-{N}", "", 2290, new Date("2026-03-05T02:00:00Z"))).toBe("NWMTC32026-2290");
    expect(formatNumber("{YY}{MM}-{N:3}", "", 7, nov)).toBe("2611-007");
    // 4:30 PM on Dec 31 in UTC is already Jan 1 in Manila.
    expect(formatNumber("{YYYY}{MM}{N}", "", 1, new Date("2026-12-31T16:30:00Z"))).toBe("2027011");
  });
  it("never cuts a longer number", () => {
    expect(formatNumber("A{N:2}", "", 12345, nov)).toBe("A12345");
  });
  it("needs the running number once and known tokens only", () => {
    expect(formatProblem("NWMTACI-{CODE}{YYYY}{N:6}")).toBeNull();
    expect(formatProblem("X{N}")).toBeNull();
    expect(formatProblem("NWMTACI-{CODE}")).toMatch(/Add \{N\}/);
    expect(formatProblem("{N}{N:6}")).toMatch(/Add \{N\}/);
    expect(formatProblem("X{N}{DD}")).toMatch(/Use only/);
    expect(formatProblem("X{N")).toMatch(/Use only/);
  });
  it("has the database follow the same tokens, and keeps printed numbers", () => {
    const sql = readFileSync(new URL("../supabase/migrations/202610290079_certificate_number_formats.sql", import.meta.url), "utf8");
    for (const token of ["{CODE}", "{YYYY}", "{YY}", "{MM}", "{M}"]) expect(sql).toContain(`'${token}'`);
    expect(sql).toContain("greatest(coalesce(width::int, 0), length(n::text))");
    // Only numbers reserved and not printed are released when a format changes.
    expect(sql).toContain("not exists (select 1 from public.certificates c where c.enrollment_id = e.id and c.certificate_number is not null)");
  });
});
