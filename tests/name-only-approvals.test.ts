import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Owner, 10 Nov 2026: Releasing corrects only the name; Accounting previews proof with an eye; fewer buttons per row.
const route = readFileSync("app/api/staff/operations/route.ts", "utf8");
const releasing = readFileSync("components/portal/releasing-home.tsx", "utf8");
const accounting = readFileSync("components/portal/accounting-home.tsx", "utf8");

describe("Releasing corrects only the name", () => {
  it("saves the name alone; course, batch and dates come from the system", () => {
    const at = route.indexOf('if (input.action === "certificate-correct") {');
    const body = route.slice(at, at + 2400);
    expect(body).toContain('const next: Record<string, string> = input.name ? { name: input.name } : {};');
    expect(body).not.toContain("courseName: input.courseName");
    expect(releasing).toContain('action: "certificate-correct", enrollmentId: line.e.id, name: (form.name ?? "").trim(), reason: (form.reason ?? "").trim()');
    expect(releasing).toContain('<span className="cl-sub">From the system</span>');
  });
});

describe("Accounting approvals", () => {
  it("shows an eye per receipt photo and one Actions menu instead of Approve and Reject buttons", () => {
    expect(accounting).toContain('<ViewIcon key={f.fileId} label={`View Receipt ${i + 1}`} href={f.link} />');
    expect(accounting).toContain('{ label: "Reject with Reason", onClick: onReject, danger: true }');
    expect(accounting.match(/<ApprovalEyes r=\{r\} \/><ApprovalActions/g)).toHaveLength(2);
  });
});
