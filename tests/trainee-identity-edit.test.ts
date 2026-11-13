import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/staff/operations/route.ts", "utf8");
const app = readFileSync("components/portal-live-app.tsx", "utf8");

describe("Registration edits name, birth date and SRN (13 Nov 2026)", () => {
  it("accepts the identity fields and needs a reason when one changes", () => {
    expect(route).toContain("firstName: z.string().trim().min(1, \"Enter the first name.\")");
    expect(route).toContain("if (changedKeys.length && (input.identityReason ?? \"\").length < 5)");
    expect(route).toContain("action: \"trainee.identity_changed\"");
    expect(route).toContain("That SRN belongs to another trainee.");
  });
  it("shows the fields, the reason box and the printed-certificate warning", () => {
    expect(app).toContain("Reason for Change (Required)");
    expect(app).toContain("the old name until Releasing corrects and reprints");
    expect(app).not.toContain("Name, SRN and birth date are kept as recorded.");
  });
});
