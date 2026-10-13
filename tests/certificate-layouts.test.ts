import { describe, expect, it } from "vitest";
import { certificateLayout, isHazmatCfr, ordinal } from "@/lib/certificate-layouts";

describe("certificate layouts", () => {
  it("finds HAZMAT with CFR by code or name", () => {
    expect(isHazmatCfr({ code: "HAZMAT-CFR", name: "HAZMAT with CFR" })).toBe(true);
    expect(isHazmatCfr({ code: "HAZMAT", name: "HAZMAT with CFR Cargoes" })).toBe(true);
    expect(isHazmatCfr({ code: "HAZMAT", name: "Dangerous, Hazardous and Harmful Cargoes (HAZMAT)" })).toBe(false);
    expect(certificateLayout({ code: "BT", name: "Basic Training" })).toBeNull();
  });
  it("writes the day suffix like the sample (24th)", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 24, 31].map((d) => `${d}${ordinal(d)}`)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "24th", "31st"]);
  });
});
