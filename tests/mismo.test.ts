import { describe, expect, it } from "vitest";
import { balanceAt, cutDateOf, entryDays, finalList, leftOff, manilaInstant, mismoCopyText, mismoCsv, mismoMissing, mismoPaidCsv, mismoState, owesAt, paidLate, unsettledAt11, type MismoBatch, type MismoTrainee } from "../lib/mismo";

const t = (id: string, due: number, b11: number, b16: number, now: number, extra: Partial<MismoTrainee> = {}): MismoTrainee => ({ enrollmentId: id, lastName: id.toUpperCase(), firstName: "Juan", middleName: null, birthdate: "1990-01-01", srn: "SRN-1", rank: "AB", dueCentavos: due, paidBy11: b11, paidBy16: b16, paidNow: now, ...extra });
const batch = (trainees: MismoTrainee[]): MismoBatch => ({ id: "b1", batchNumber: "BCH-1", courseName: "Crowd Management", courseCode: "PSCMT", startsOn: "2026-10-08", endsOn: "2026-10-09", room: "Room 1", instructor: "Capt. X", trainees, submittedAt: null, submittedCount: null });

describe("MISMO officer's list (Design 3)", () => {
  it("puts each trainee in one state; only paid trainees with complete details can be input", () => {
    expect(mismoState(t("a", 100, 0, 0, 0))).toBe("Not Paid Yet");
    expect(mismoState(t("b", 100, 100, 100, 100))).toBe("To Input");
    expect(mismoState(t("c", 100, 100, 100, 100, { entryAt: "2026-11-05T02:00:00Z" }))).toBe("Done");
    expect(mismoState(t("d", 100, 100, 100, 100, { srn: null }))).toBe("Missing Details");
    expect(mismoMissing(t("e", 100, 100, 100, 100, { srn: null, birthdate: null }))).toEqual(["SRN", "Birth Date"]);
    expect(mismoState(t("f", 100, 0, 0, 0, { companyCharge: true }))).toBe("To Input");
  });
  it("marks a trainee who paid after the 4:00 PM cut-off as Paid Late, still to input", () => {
    const late = t("late", 100, 0, 0, 100);
    expect(paidLate(late)).toBe(true);
    expect(mismoState(late)).toBe("To Input");
    expect(finalList(batch([late]))).toEqual([]);
    expect(paidLate(t("onTime", 100, 0, 100, 100))).toBe(false);
  });
  it("exports everyone paid so far, and copies one trainee tab separated", () => {
    const b = batch([t("late", 100, 0, 0, 100), t("no", 100, 0, 0, 0)]);
    const csv = mismoPaidCsv([b]).split("\r\n");
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain("LATE");
    expect(mismoCopyText(b.trainees[0], b).split("\t")[0]).toBe("LATE");
  });
  it("takes the cut-off on the batch's first class day in the period", () => {
    expect(cutDateOf("2026-11-05", "2026-11-05")).toBe("2026-11-05");
    expect(cutDateOf("2026-11-04", "2026-11-05")).toBe("2026-11-05");
    expect(cutDateOf("2026-11-10", "2026-11-01")).toBe("2026-11-10");
  });
  it("counts ticks per batch and Manila day", () => {
    const row = (doneAt: string, by: string) => ({ doneAt, by, batchId: "b1", batchNumber: "26-1", code: "PSCMT" });
    const days = entryDays([row("2026-11-05T02:00:00Z", "A"), row("2026-11-05T03:00:00Z", "B"), row("2026-11-05T16:30:00Z", "C")]);
    expect(days.map((d) => [d.day, d.count, d.by])).toEqual([["2026-11-05", 2, "B"], ["2026-11-06", 1, "C"]]);
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
    expect(leftOff(b).map((x) => x.enrollmentId)).toEqual(["partial", "unpaid"]);
    expect(balanceAt(b.trainees[2], "16")).toBe(45000);
    expect(owesAt(b.trainees[2], "now")).toBe(false);
  });
  it("counts Company Charge trainees as settled (the partner pays on its Billing Statement)", () => {
    const b = batch([t("billed", 130000, 0, 0, 0, { companyCharge: true }), t("unpaid", 130000, 0, 0, 0)]);
    expect(unsettledAt11(b).map((x) => x.enrollmentId)).toEqual(["unpaid"]);
    expect(finalList(b).map((x) => x.enrollmentId)).toEqual(["billed"]);
    expect(balanceAt(b.trainees[0], "16")).toBe(0);
  });
  it("writes the CSV for settled trainees only, quoting commas", () => {
    const csv = mismoCsv(batch([t("ok", 100, 100, 100, 100, { middleName: "Dela Cruz, Jr." }), t("no", 100, 0, 0, 0)])).split("\r\n");
    expect(csv[0]).toBe("Last name,First name,Middle name,Birth date,SRN,Rank,Course,Course code,Batch,Training start,Training end");
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain('"Dela Cruz, Jr."');
    expect(csv[1]).toContain("PSCMT,BCH-1,2026-10-08,2026-10-09");
  });
});
