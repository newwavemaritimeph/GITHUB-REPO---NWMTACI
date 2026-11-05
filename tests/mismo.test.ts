import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { NO_FILTER, balanceAt, cutDateOf, entryMovedFrom, finalList, lineOfEntry, lineOfRow, manilaInstant, mismoListed, mismoCopyText, mismoCsv, mismoFiltered, mismoMissing, mismoRowsCsv, mismoSorted, mismoState, mismoWork, owesAt, paidLate, unsettledAt11, whenOf, type MismoBatch, type MismoEntry, type MismoRow, type MismoTrainee } from "../lib/mismo";
import { MismoWorkList } from "../components/portal/mismo-home";

const t = (id: string, due: number, b11: number, b16: number, now: number, extra: Partial<MismoTrainee> = {}): MismoTrainee => ({ enrollmentId: id, lastName: id.toUpperCase(), firstName: "Juan", middleName: null, birthdate: "1990-01-01", srn: "SRN-1", rank: "AB", dueCentavos: due, paidBy11: b11, paidBy16: b16, paidNow: now, ...extra });
const batch = (trainees: MismoTrainee[]): MismoBatch => ({ id: "b1", batchNumber: "BCH-1", courseName: "Crowd Management", courseCode: "PSCMT", startsOn: "2026-10-08", endsOn: "2026-10-09", room: "Room 1", instructor: "Capt. X", trainees, submittedAt: null, submittedCount: null });

describe("MISMO officer's list (Design 3)", () => {
  it("puts each trainee in one state; only paid trainees with complete details can be input", () => {
    expect(mismoState(t("a", 100, 0, 0, 0))).toBe("Unpaid");
    expect(mismoState(t("b", 100, 100, 100, 100))).toBe("For Encoding");
    expect(mismoState(t("c", 100, 100, 100, 100, { entryAt: "2026-11-05T02:00:00Z" }))).toBe("Encoded");
    expect(mismoState(t("d", 100, 100, 100, 100, { srn: null }))).toBe("For Completion");
    expect(mismoMissing(t("e", 100, 100, 100, 100, { srn: null, birthdate: null }))).toEqual(["SRN", "Birth Date"]);
    expect(mismoState(t("f", 100, 0, 0, 0, { companyCharge: true }))).toBe("For Encoding");
  });
  it("marks a trainee who paid after the 4:00 PM cut-off as Paid Late, still to input", () => {
    const late = t("late", 100, 0, 0, 100);
    expect(paidLate(late)).toBe(true);
    expect(mismoState(late)).toBe("For Encoding");
    expect(finalList(batch([late]))).toEqual([]);
    expect(paidLate(t("onTime", 100, 0, 100, 100))).toBe(false);
  });
  it("exports everyone paid so far, and copies one trainee tab separated", () => {
    const b = batch([t("late", 100, 0, 0, 100), t("no", 100, 0, 0, 0)]);
    const csv = mismoRowsCsv(mismoWork([b]).flatMap((x) => x.trainees.map((t) => ({ b: x, t })))).split("\r\n");
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain("LATE");
    expect(mismoCopyText(b.trainees[0], b).split("\t")[0]).toBe("LATE");
  });
  it("takes the cut-off on the batch's first class day in the period", () => {
    expect(cutDateOf("2026-11-05", "2026-11-05")).toBe("2026-11-05");
    expect(cutDateOf("2026-11-04", "2026-11-05")).toBe("2026-11-05");
    expect(cutDateOf("2026-11-10", "2026-11-01")).toBe("2026-11-10");
  });
});

describe("MISMO List: upcoming batches, sort and filters", () => {
  const paidUp = (id: string, extra: Partial<MismoTrainee> = {}) => t(id, 100, 100, 100, 100, extra);
  const at = (id: string, code: string, starts: string, ends: string, trainees: MismoTrainee[]): MismoBatch => ({ ...batch(trainees), id, batchNumber: id, courseCode: code, startsOn: starts, endsOn: ends });
  const today = "2026-11-05";
  const past = at("26-1", "UBT-PSSR", "2026-11-03", "2026-11-03", [paidUp("zed", { lastPaidAt: "2026-11-01T01:00:00Z" })]);
  const inClass = at("26-2", "PSCMT", "2026-11-04", "2026-11-05", [paidUp("mid", { lastPaidAt: "2026-11-04T01:00:00Z" })]);
  const upcoming = at("26-3", "STPPDSPPS", "2026-11-09", "2026-11-09", [paidUp("abe", { lastPaidAt: "2026-11-02T01:00:00Z" }), paidUp("cal", { companyCharge: true, dueCentavos: 100, paidNow: 0, paidBy16: 0, paidBy11: 0 })]);
  const rows: MismoRow[] = [upcoming, inClass, past].flatMap((b) => b.trainees.map((tr) => ({ b, t: tr })));

  it("lists paid and Company Charge trainees of upcoming batches, and leaves out the unpaid and the encoded", () => {
    const work = mismoWork([at("26-4", "PSCMT", "2026-11-10", "2026-11-11", [paidUp("paid"), t("down", 100, 50, 50, 50), t("none", 100, 0, 0, 0), paidUp("done", { entryAt: "2026-11-05T02:00:00Z" }), t("billed", 100, 0, 0, 0, { companyCharge: true })])]);
    expect(work[0].trainees.map((x) => x.enrollmentId)).toEqual(["paid", "billed"]);
    expect(mismoWork([at("26-5", "PSCMT", "2026-11-10", "2026-11-11", [t("none", 100, 0, 0, 0)])])).toEqual([]);
  });
  it("tells past, today and upcoming; a class in session counts as today", () => {
    expect(whenOf("2026-11-03", "2026-11-03", today)).toBe("Past Classes");
    expect(whenOf("2026-11-04", "2026-11-05", today)).toBe("Today");
    expect(whenOf("2026-11-04", "2026-11-06", today)).toBe("Today");
    expect(whenOf("2026-11-09", "2026-11-09", today)).toBe("Upcoming");
  });
  it("filters by class date, course, batch and search", () => {
    const names = (f: Partial<typeof NO_FILTER>) => mismoFiltered(rows, lineOfRow, { ...NO_FILTER, ...f }, today).map((r) => r.t.enrollmentId).sort();
    expect(names({ when: "Upcoming" })).toEqual(["abe", "cal"]);
    expect(names({ when: "Today" })).toEqual(["mid"]);
    expect(names({ course: "UBT-PSSR" })).toEqual(["zed"]);
    expect(names({ batch: "26-2" })).toEqual(["mid"]);
    expect(names({ q: "abe" })).toEqual(["abe"]);
    expect(mismoFiltered(rows, lineOfRow, { ...NO_FILTER, when: "Today" }, today, true)).toHaveLength(4);
  });
  it("sorts by class date oldest first, batch, course, trainee, and newest payment with the unpaid-by-date last", () => {
    const order = (sort: Parameters<typeof mismoSorted>[1]) => mismoSorted(rows, sort, lineOfRow).map((r) => r.t.enrollmentId);
    expect(order("date")).toEqual(["zed", "mid", "abe", "cal"]);
    expect(order("batch")).toEqual(["zed", "mid", "abe", "cal"]);
    expect(order("course")).toEqual(["mid", "abe", "cal", "zed"]);
    expect(order("name")).toEqual(["abe", "cal", "mid", "zed"]);
    expect(order("at")).toEqual(["mid", "abe", "zed", "cal"]);
  });
  it("lets a tick stand until the trainee moves batch or the batch moves date", () => {
    const current = { batchNumber: "26-3", startsOn: "2026-11-09" };
    expect(entryMovedFrom({ batchNumber: "26-3", classStart: "2026-11-09" }, current)).toBeNull();
    expect(entryMovedFrom({ batchNumber: "26-1", classStart: "2026-11-03" }, current)).toBe("26-1");
    expect(entryMovedFrom({ batchNumber: "26-3", classStart: "2026-11-06" }, current)).toBe("Nov 6");
    expect(entryMovedFrom({ batchNumber: null, classStart: null }, current)).toBeNull();
  });
  it("sorts the Encoded list newest first by encoding time", () => {
    const entry = (id: string, doneAt: string): MismoEntry => ({ enrollmentId: id, lastName: id, firstName: "A", middleName: null, srn: null, batchNumber: "26-1", code: "PSCMT", startsOn: "2026-11-04", endsOn: "2026-11-05", doneAt, by: "Officer", cancelled: false });
    expect(mismoSorted([entry("old", "2026-11-01T00:00:00Z"), entry("new", "2026-11-05T00:00:00Z")], "at", lineOfEntry).map((e) => e.enrollmentId)).toEqual(["new", "old"]);
  });
  it("shows upcoming trainees with their chips and every tool, with no unpaid name", () => {
    const moved: MismoRow = { b: upcoming, t: paidUp("moved", { movedFrom: "26-1" }) };
    const html = renderToStaticMarkup(createElement(MismoWorkList, { stage: "For Encoding", rows: [...rows, moved], loaded: true, filter: NO_FILTER, setFilter: () => undefined, sort: "date", setSort: () => undefined, today, copied: "", onCopy: () => undefined, onEncode: () => undefined, onAdd: () => undefined }));
    for (const text of ["Search", "Course", "Batch", "Class Date", "Sort", "Upcoming (3)", "Today (1)", "Past Classes (1)", "Paid On · Newest First", "Company Charge", "Moved · Was 26-1", "Encoded", "Copy", "ABE"]) expect(html).toContain(text);
    expect(html).not.toContain("NONE");
  });
});

describe("MARINA MISMO lists", () => {
  it("converts Manila times", () => {
    expect(manilaInstant("2026-10-08", 11)).toBe("2026-10-08T03:00:00.000Z");
    expect(manilaInstant("2026-10-08", 16)).toBe("2026-10-08T08:00:00.000Z");
  });
  it("lists trainees still owing at 11:00 AM and keeps only those settled by 4:00 PM", () => {
    const b = batch([
      t("paidEarly", 90000, 90000, 90000, 90000),
      t("paidAfternoon", 90000, 0, 90000, 90000),
      t("partial", 90000, 45000, 45000, 90000),
      t("unpaid", 90000, 0, 0, 0),
    ]);
    expect(unsettledAt11(b).map((x) => x.enrollmentId)).toEqual(["paidAfternoon", "partial", "unpaid"]);
    expect(finalList(b).map((x) => x.enrollmentId)).toEqual(["paidEarly", "paidAfternoon"]);
    expect(b.trainees.filter(paidLate).map((x) => x.enrollmentId)).toEqual(["partial"]);
    expect(balanceAt(b.trainees[2], "16")).toBe(45000);
    expect(owesAt(b.trainees[2], "now")).toBe(false);
  });
  it("counts Company Charge trainees as settled (the partner pays on its Billing Statement)", () => {
    const b = batch([t("billed", 130000, 0, 0, 0, { companyCharge: true }), t("unpaid", 130000, 0, 0, 0)]);
    expect(unsettledAt11(b).map((x) => x.enrollmentId)).toEqual(["unpaid"]);
    expect(finalList(b).map((x) => x.enrollmentId)).toEqual(["billed"]);
    expect(balanceAt(b.trainees[0], "16")).toBe(0);
  });
  it("takes a trainee not yet paid off the officer's lists, unless on Company Charge", () => {
    expect(mismoListed(t("paid", 100, 100, 100, 100))).toBe(true);
    expect(mismoListed(t("billed", 100, 0, 0, 0, { companyCharge: true }))).toBe(true);
    expect(mismoListed(t("unpaid", 100, 0, 0, 0))).toBe(false);
    expect(mismoListed(t("balance", 100, 50, 50, 50))).toBe(false);
  });
  it("writes the CSV for settled trainees only, quoting commas", () => {
    const csv = mismoCsv(batch([t("ok", 100, 100, 100, 100, { middleName: "Dela Cruz, Jr." }), t("no", 100, 0, 0, 0)])).split("\r\n");
    expect(csv[0]).toBe("Last name,First name,Middle name,Birth date,SRN,Rank,Course,Course code,Batch,Training start,Training end");
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain('"Dela Cruz, Jr."');
    expect(csv[1]).toContain("PSCMT,BCH-1,2026-10-08,2026-10-09");
  });
});
