import { describe, expect, it } from "vitest";
import { dialogWording } from "@/components/portal/dialogs";

describe("confirm dialog wording", () => {
  it("turns the question into the title, the rest into the body, and names the verb", () => {
    expect(dialogWording("confirm", "Archive SAMPLE, Maria L.? She no longer appears in lists.", {})).toEqual({ title: "Archive SAMPLE, Maria L.?", body: "She no longer appears in lists.", okLabel: "Archive", danger: true });
    expect(dialogWording("confirm", "Approve this change? Update the 201 too.", {})).toMatchObject({ title: "Approve this change?", okLabel: "Approve", danger: false });
  });
  it("keeps a caller's own title and label, and never says OK", () => {
    expect(dialogWording("confirm", "Post it?", { title: "Post Payment", okLabel: "Post" })).toMatchObject({ title: "Post Payment", okLabel: "Post" });
    expect(dialogWording("alert", "Saved.", {}).okLabel).toBe("Close");
    expect(dialogWording("confirm", "This cannot be undone", {}).okLabel).toBe("Confirm");
  });
});
