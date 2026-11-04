import { describe, expect, it } from "vitest";
import { rankMatches, sameTrainee, tarGroups, tarPrintable } from "@/lib/trainee-match";

describe("rankMatches", () => {
  const people = [{ n: "JESTER RUAZOL NATIVIDAD", o: "NWMTACI-0000019 UBT-PSSR" }, { n: "JAYSON JAYSON CABRERO", o: "NWMTACI-0000022 APA" }, { n: "KING STEPHEN PACQUING", o: "NWMTACI-0000002 UBT-PSSR" }];
  const rank = (t: string) => rankMatches(people, t, (p) => p.n, (p) => p.o).map((p) => p.n.split(" ")[0]);
  it("lists nothing until a letter is typed", () => expect(rank("  ")).toEqual([]));
  it("puts names with a word starting with the letters first", () => expect(rank("ja")).toEqual(["JAYSON"]));
  it("then anything containing the letters, number or course", () => { expect(rank("az")).toEqual(["JESTER"]); expect(rank("0000002")).toEqual(["KING"]); expect(rank("ubt")).toEqual(["JESTER", "KING"]); });
  it("keeps at most the limit", () => expect(rankMatches(people, "n", (p) => p.n, (p) => p.o, 2)).toHaveLength(2));
});

describe("TAR courses", () => {
  it("prints every course that is not cancelled, paid or not", () => {
    expect(tarPrintable({ enrollment_status: "Enrolled" })).toBe(true);
    expect(tarPrintable({ enrollment_status: "Pending" })).toBe(true);
    expect(tarPrintable({ enrollment_status: "Open Schedule" })).toBe(true);
    expect(tarPrintable({ enrollment_status: "Cancelled" })).toBe(false);
  });
});

describe("same trainee, two records", () => {
  const a = { id: "1", srn: "1234567890", legal_first_name: "Juan", legal_last_name: "Maneje", birthdate: "1990-01-02" };
  it("matches on SRN, or on name and birth date", () => {
    expect(sameTrainee(a, { id: "2", srn: "1234567890" })).toBe(true);
    expect(sameTrainee(a, { id: "3", srn: null, legal_first_name: "juan", legal_last_name: "MANEJE ", birthdate: "1990-01-02" })).toBe(true);
    expect(sameTrainee(a, { id: "4", srn: null, legal_first_name: "Juan", legal_last_name: "Maneje", birthdate: "1991-01-02" })).toBe(false);
    expect(sameTrainee(a, a)).toBe(false);
  });
});

describe("one TAR per transaction", () => {
  const row = (id: string, created_at: string, more: { enrollment_status?: string; receipt_at?: string; paid_by?: string } = {}) => ({ id, created_at, enrollment_status: "Pending", ...more });
  const ids = (groups: { ids: string[] }[]) => groups.map((g) => g.ids);
  it("separates the morning and the afternoon of one day, newest first", () => {
    const groups = tarGroups([row("apa", "2026-11-04T01:12:00Z"), row("crowd", "2026-11-04T06:40:00Z")]);
    expect(ids(groups)).toEqual([["crowd"], ["apa"]]);
    expect(groups[1]).toMatchObject({ date: "2026-11-04", at: "2026-11-04T01:12:00Z" });
  });
  it("keeps courses of one visit together and leaves out cancelled ones", () => {
    expect(ids(tarGroups([row("a", "2026-11-04T01:00:00Z"), row("b", "2026-11-04T01:20:00Z"), row("c", "2026-11-04T01:45:00Z"), row("gone", "2026-11-04T01:50:00Z", { enrollment_status: "Cancelled" })]))).toEqual([["a", "b", "c"]]);
  });
  it("does not combine with a printed TAR, even minutes later", () => {
    expect(ids(tarGroups([row("a", "2026-11-04T01:00:00Z"), row("b", "2026-11-04T01:05:00Z")], [["a"]]))).toEqual([["b"], ["a"]]);
  });
  it("does not combine with a receipt, even minutes later", () => {
    expect(ids(tarGroups([row("a", "2026-11-04T01:00:00Z", { receipt_at: "2026-11-04T01:03:00Z" }), row("b", "2026-11-04T01:05:00Z")]))).toEqual([["b"], ["a"]]);
  });
  it("separates a course settled alone from one added with it and still unpaid", () => {
    expect(ids(tarGroups([row("a", "2026-11-04T01:00:00Z", { receipt_at: "2026-11-04T01:10:00Z", paid_by: "p1" }), row("b", "2026-11-04T01:05:00Z")]))).toEqual([["b"], ["a"]]);
  });
  it("keeps one TAR with both receipts when it was printed before the courses were paid separately", () => {
    expect(ids(tarGroups([row("a", "2026-11-04T01:00:00Z", { paid_by: "p1" }), row("b", "2026-11-04T01:05:00Z", { paid_by: "p2" })], [["a", "b"]]))).toEqual([["a", "b"]]);
  });
  it("keeps an issued TAR whole, whatever the times, and the newest record wins", () => {
    expect(ids(tarGroups([row("a", "2026-11-04T01:00:00Z"), row("b", "2026-11-04T07:00:00Z")], [["a", "b"]]))).toEqual([["a", "b"]]);
    expect(ids(tarGroups([row("a", "2026-11-03T01:00:00Z"), row("b", "2026-11-04T07:00:00Z")], [["a", "b"], ["a"]]))).toEqual([["a", "b"]]);
  });
  it("makes courses paid together one transaction, whenever they were added", () => {
    const paid = { receipt_at: "2026-11-04T08:00:00Z" };
    expect(ids(tarGroups([row("a", "2026-11-04T01:00:00Z", { ...paid, paid_by: "p1" }), row("b", "2026-11-04T06:00:00Z", { ...paid, paid_by: "p1" })]))).toEqual([["a", "b"]]);
  });
  it("keeps courses paid separately apart", () => {
    const paid = { receipt_at: "2026-11-04T08:00:00Z" };
    expect(ids(tarGroups([row("a", "2026-11-04T01:00:00Z", { ...paid, paid_by: "p1" }), row("b", "2026-11-04T06:00:00Z", { ...paid, paid_by: "p2" })]))).toEqual([["b"], ["a"]]);
  });
  it("does not combine a new course with one already paid, even when its balance is paid together", () => {
    expect(ids(tarGroups([row("a", "2026-11-04T01:00:00Z", { receipt_at: "2026-11-04T01:03:00Z", paid_by: "p1" }), row("b", "2026-11-04T01:05:00Z", { receipt_at: "2026-11-04T02:00:00Z", paid_by: "p2" })]))).toEqual([["b"], ["a"]]);
  });
  it("does not reopen a printed TAR when its course is paid together with a new one", () => {
    const paid = { receipt_at: "2026-11-04T08:00:00Z", paid_by: "p1" };
    expect(ids(tarGroups([row("a", "2026-11-04T01:00:00Z", paid), row("b", "2026-11-04T06:00:00Z", paid)], [["a"]]))).toEqual([["b"], ["a"]]);
  });
  it("closes a paid-together transaction to a course added afterwards", () => {
    const paid = { receipt_at: "2026-11-04T07:00:00Z", paid_by: "p1" };
    expect(ids(tarGroups([row("a", "2026-11-04T01:00:00Z", paid), row("b", "2026-11-04T06:50:00Z", paid), row("c", "2026-11-04T07:05:00Z")]))).toEqual([["c"], ["a", "b"]]);
  });
});
