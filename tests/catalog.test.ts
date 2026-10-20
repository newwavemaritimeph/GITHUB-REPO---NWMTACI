import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENDORSEMENT_OFFERS, ENDORSEMENT_SUMMARY } from "../lib/endorsement-catalog";
import { IN_HOUSE_COURSES } from "../lib/in-house-catalog";

describe("course catalogs", () => {
  // The July 2026 matrix stays only as a reference file; endorsed programs are
  // encoded in the portal by Accounting or the Admin (owner, 20 Oct 2026).
  it("keeps the July 2026 reference matrix of 96 endorsed offers by center", () => {
    expect(ENDORSEMENT_OFFERS).toHaveLength(96);
    expect(Object.fromEntries(ENDORSEMENT_SUMMARY.map((item) => [item.center, item.offers]))).toEqual({
      "Nautical Options": 18, Fareast: 26, "Altitude Maritime": 18, "Great Seas": 24, "United International": 10,
    });
  });

  it("does not seed endorsed programs, so a re-seed cannot bring them back", () => {
    const seed = readFileSync(new URL("../scripts/seed-catalog.ts", import.meta.url), "utf8");
    expect(seed).not.toContain("partner_course_offers");
    expect(seed).not.toContain("ENDORSEMENT_OFFERS");
    expect(seed).toContain('from("partner_centers")');
  });

  it("calculates fees, rebates, and partner payables in centavos", () => {
    const etr = ENDORSEMENT_OFFERS.find((offer) => offer.center === "Fareast" && offer.course === "ETR");
    expect(etr).toMatchObject({ trainingFeeCentavos: 19_000_000, rebateCentavos: 1_000_000, partnerPayableCentavos: 18_000_000 });
  });

  it("normalizes known source formatting anomalies", () => {
    expect(ENDORSEMENT_OFFERS.find((offer) => offer.center === "Altitude Maritime" && offer.course === "SCRB-R")?.duration).toBe("1.5 days");
    expect(ENDORSEMENT_OFFERS.find((offer) => offer.center === "Fareast" && offer.course === "SCRB - Face-to-face")?.duration).toBe("5 days");
  });

  it("includes all New Wave courses with price and duration", () => {
    expect(IN_HOUSE_COURSES).toHaveLength(148);
    expect(IN_HOUSE_COURSES.every((course) => course.priceCentavos > 0 && course.duration.length > 0)).toBe(true);
    expect(IN_HOUSE_COURSES.find((course) => course.code === "VRM")).toMatchObject({ duration: "5 days", priceCentavos: 500_000 });
  });
});
