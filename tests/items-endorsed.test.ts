import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isEndorsedEnrollment, itemAllowed } from "@/lib/company-charge";

// Items to Collect (owner, 10 Nov 2026): New Wave's own courses take every item; an endorsed course only Online Medical.
const items = ["Uniform", "LBC", "Online Assessment", "Online Medical"];

describe("Items for endorsed courses", () => {
  it("keeps every item for a New Wave course and only Online Medical for an endorsed one", () => {
    expect(items.filter((n) => itemAllowed(n, false))).toEqual(items);
    expect(items.filter((n) => itemAllowed(n, true))).toEqual(["Online Medical"]);
    expect(isEndorsedEnrollment({ partner_offer_id: "x" })).toBe(true);
    expect(isEndorsedEnrollment({ partner_offer_id: null }, "Partner or Endorsed")).toBe(true);
    expect(isEndorsedEnrollment({ partner_offer_id: null }, "In-House")).toBe(false);
  });
  it("refuses other items on the server: the hand-over and the Cashier's payment", () => {
    const route = readFileSync("app/api/staff/operations/route.ts", "utf8");
    expect(route.match(/Only Online Medical can be added to an endorsed course\./g)).toHaveLength(2);
    expect(readFileSync("components/portal/live-registration.tsx", "utf8")).toContain("itemAllowed(c.name, endorsed)");
    expect(readFileSync("components/portal/live-cashier.tsx", "utf8")).toContain("itemAllowed(c.name, itemEndorsed)");
  });
});
