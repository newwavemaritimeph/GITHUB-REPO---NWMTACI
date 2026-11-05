import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ALL_DATES, ViewIcon, periodRange, pickRange } from "@/components/portal/shared-ui";
import { needsFullRefresh } from "@/lib/portal-format";

// Every list opens on the month (owner, 3 Nov 2026); the range must cover the whole month.
describe("Pick a Date First", () => {
  it("turns each pick into its dates", () => {
    expect(pickRange("Today", "2026-11-05", "", "")).toMatchObject({ from: "2026-11-05", to: "2026-11-05" });
    expect(pickRange("This Week", "2026-11-05", "", "")).toMatchObject({ from: "2026-11-02", to: "2026-11-08" });
    expect(pickRange("This Month", "2026-11-05", "", "")).toMatchObject({ from: "2026-11-01", to: "2026-11-30" });
    expect(pickRange("Last Month", "2026-11-05", "", "")).toMatchObject({ from: "2026-10-01", to: "2026-10-31", label: "October 2026" });
    expect(pickRange("Last Month", "2027-01-15", "", "")).toMatchObject({ from: "2026-12-01", to: "2026-12-31" });
    expect(pickRange("Custom", "2026-11-05", "2026-10-03", "2026-10-09")).toMatchObject({ from: "2026-10-03", to: "2026-10-09" });
  });
});

describe("periodRange Monthly", () => {
  it("covers the first to the last day of the month", () => {
    expect(periodRange("Monthly", "2026-11-04")).toMatchObject({ from: "2026-11-01", to: "2026-11-30", label: "November 2026" });
    expect(periodRange("Monthly", "2026-12-31")).toMatchObject({ from: "2026-12-01", to: "2026-12-31" });
  });
  it("handles February", () => {
    expect(periodRange("Monthly", "2027-02-15")).toMatchObject({ from: "2027-02-01", to: "2027-02-28" });
    expect(periodRange("Monthly", "2028-02-15")).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
  });
  it("All Dates reaches past the search floor", () => {
    expect(periodRange("All Dates", "2026-11-04").from < ALL_DATES).toBe(true);
  });
});

// View is a round eye icon everywhere (owner, 4 Nov 2026), still named for screen readers.
describe("ViewIcon", () => {
  it("is a link with a name when given an address", () => {
    const html = renderToStaticMarkup(createElement(ViewIcon, { label: "View Proof", href: "https://drive.google.com/x" }));
    expect(html).toContain('href="https://drive.google.com/x"');
    expect(html).toContain('aria-label="View Proof"');
    expect(html).toContain('target="_blank"');
  });
  it("is a button otherwise and can be disabled", () => {
    const html = renderToStaticMarkup(createElement(ViewIcon, { label: "View Photo", disabled: true }));
    expect(html).toContain("<button");
    expect(html).toContain("disabled");
  });
});

// The refresh reloads only on news (owner, 4 Nov 2026: "make it faster").
describe("needsFullRefresh", () => {
  it("skips the reload when nothing changed", () => expect(needsFullRefresh("a", "a", 10000)).toBe(false));
  it("reloads on a change", () => expect(needsFullRefresh("a", "b", 10000)).toBe(true));
  it("reloads at least once a minute", () => expect(needsFullRefresh("a", "a", 60000)).toBe(true));
  it("reloads as before when the database update is not run yet", () => {
    expect(needsFullRefresh(null, null, 1000)).toBe(true);
    expect(needsFullRefresh("a", null, 1000)).toBe(true);
  });
});
