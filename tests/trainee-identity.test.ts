import { describe, expect, it } from "vitest";
import { chooseSurvivor, findContactDuplicates, findSrnDuplicates, mergeInto } from "../lib/trainee-identity";

const records = [
  { id: "a", srn: "1234567890", email: "juan@example.com", mobile: "09171234567", createdAt: "2026-01-10T00:00:00Z" },
  { id: "b", srn: "123 456 7890", email: "j.delacruz@example.com", mobile: "09990001111", createdAt: "2026-05-02T00:00:00Z" },
  { id: "c", srn: "9999999999", email: "maria@example.com", mobile: "09281234567", createdAt: "2026-02-01T00:00:00Z" },
  { id: "d", email: "maria@example.com", mobile: "09330001111", createdAt: "2026-06-01T00:00:00Z" },
];

describe("SRN duplicates", () => {
  it("matches regardless of how the SRN was spaced", () => {
    expect(findSrnDuplicates(records[0], records).map((row) => row.id)).toEqual(["b"]);
    expect(findSrnDuplicates(records[1], records).map((row) => row.id)).toEqual(["a"]);
  });

  it("never matches a record against itself", () => {
    expect(findSrnDuplicates(records[2], records)).toEqual([]);
  });

  it("finds nothing when the candidate has no SRN", () => {
    expect(findSrnDuplicates(records[3], records)).toEqual([]);
  });

  it("ignores malformed SRNs rather than grouping them together", () => {
    const malformed = [
      { id: "x", srn: "12345", createdAt: "2026-01-01T00:00:00Z" },
      { id: "y", srn: "12345", createdAt: "2026-01-02T00:00:00Z" },
    ];
    expect(findSrnDuplicates(malformed[0], malformed)).toEqual([]);
  });
});

describe("contact duplicates", () => {
  it("flags a shared email when there is no SRN match", () => {
    expect(findContactDuplicates(records[3], records).map((row) => row.id)).toEqual(["c"]);
  });

  it("does not re-report a record already matched on SRN", () => {
    expect(findContactDuplicates(records[0], records)).toEqual([]);
  });
});

describe("merging", () => {
  it("keeps the earliest record so the trainee number survives", () => {
    expect(chooseSurvivor([records[1], records[0]])?.id).toBe("a");
  });

  it("fills only blank fields and never overwrites confirmed values", () => {
    const survivor = { id: "a", rank: "Able Seaman", company: "", placeOfBirth: undefined as string | undefined };
    const duplicate = { id: "b", rank: "Bosun", company: "Oceanic", placeOfBirth: "Cebu" };
    const merged = mergeInto(survivor, duplicate, ["rank", "company", "placeOfBirth"]);
    expect(merged.rank).toBe("Able Seaman");
    expect(merged.company).toBe("Oceanic");
    expect(merged.placeOfBirth).toBe("Cebu");
  });
});
