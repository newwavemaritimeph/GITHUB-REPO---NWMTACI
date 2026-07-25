import { describe, expect, it } from "vitest";
import { ENDORSEMENT_OFFERS } from "../lib/endorsement-catalog";
import { IN_HOUSE_COURSES } from "../lib/in-house-catalog";
import { SYSTEM_VERSION, createSeedState } from "../lib/system/seed";

// The Admin CRUD build moved courses and partner offers into editable state.
// These guard that the seed mirrors the source catalogs so day-one data matches
// the read-only catalog it replaced.

describe("editable catalog seed", () => {
  it("bumps the system version so old localStorage reseeds", () => {
    expect(SYSTEM_VERSION).toBe(7);
    expect(createSeedState().version).toBe(7);
  });

  it("seeds every New Wave course as active with pricing intact", () => {
    const { courses } = createSeedState();
    expect(courses).toHaveLength(IN_HOUSE_COURSES.length);
    expect(courses.every((course) => course.active)).toBe(true);
    const vrm = courses.find((course) => course.code === "VRM");
    expect(vrm).toMatchObject({ duration: "5 days", priceCentavos: 500_000, active: true });
  });

  it("seeds every endorsed partner offer as active", () => {
    const { partnerOffers } = createSeedState();
    expect(partnerOffers).toHaveLength(ENDORSEMENT_OFFERS.length);
    expect(partnerOffers.every((offer) => offer.active)).toBe(true);
    const etr = partnerOffers.find((offer) => offer.center === "Fareast" && offer.course === "ETR");
    expect(etr).toMatchObject({ trainingFeeCentavos: 19_000_000, rebateCentavos: 1_000_000 });
  });

  it("keeps course codes unique so the CRUD uniqueness check is meaningful", () => {
    const codes = createSeedState().courses.map((course) => course.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
