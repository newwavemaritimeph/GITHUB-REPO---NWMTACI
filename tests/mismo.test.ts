import { describe, expect, it } from "vitest";
import { balanceAt, finalList, leftOff, manilaInstant, mismoCsv, owesAt, unsettledAt11, type MismoBatch, type MismoTrainee } from "../lib/mismo";

const t = (id: string, due: number, b11: number, b16: number, now: number, extra: Partial<MismoTrainee> = {}): MismoTrainee => ({ enrollmentId: id, lastName: id.toUpperCase(), firstName: "Juan", middleName: null, birthdate: "1990-01-01", srn: "SRN-1", rank: "AB", dueCentavos: due, paidBy11: b11, paidBy16: b16, paidNow: now, ...extra });
const batch = (trainees: MismoTrainee[]): MismoBatch => ({ id: "b1", batchNumber: "BCH-1", courseName: "Crowd Management", courseCode: "PSCMT", startsOn: "2026-10-08", endsOn: "2026-10-09", room: "Room 1", instructor: "Capt. X", trainees, submittedAt: null, submittedCount: null });

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
  it("writes the CSV for settled trainees only, quoting commas", () => {
    const csv = mismoCsv(batch([t("ok", 100, 100, 100, 100, { middleName: "Dela Cruz, Jr." }), t("no", 100, 0, 0, 0)])).split("\r\n");
    expect(csv[0]).toBe("Last name,First name,Middle name,Birth date,SRN,Rank,Course,Course code,Batch,Training start,Training end");
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain('"Dela Cruz, Jr."');
    expect(csv[1]).toContain("PSCMT,BCH-1,2026-10-08,2026-10-09");
  });
});
