import { describe, expect, it } from "vitest";
import { corrected, photoFileName, whiteBackground } from "@/lib/certificate-photo";
import { certificateState } from "@/lib/certificate-rules";

const image = (size: number, border: [number, number, number], centre: [number, number, number]) => {
  const px = new Uint8ClampedArray(size * size * 4);
  const band = Math.round(size * 0.08);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const inner = x >= band && x < size - band && y >= band && y < size - band;
    const [r, g, b] = inner ? centre : border;
    px.set([r, g, b, 255], (y * size + x) * 4);
  }
  return px;
};

describe("certificate photo", () => {
  it("names the file after the portal name, course, batch and date", () => {
    expect(photoFileName({ lastName: "Dela Cruz", firstName: "Juan", middleName: "Perez", courseCode: "UBT-PSSR", batchNumber: "BCH-2026-0412", date: "2026-10-10" })).toBe("DELA CRUZ, JUAN P - UBT-PSSR - BCH-2026-0412 - 2026-10-10.jpg");
    expect(photoFileName({ lastName: "O/Neil:", firstName: "Ana", courseCode: "HPT", batchNumber: null, date: "2026-10-09" })).toBe("O NEIL, ANA - HPT - 2026-10-09.jpg");
  });
  it("checks for a white background", () => {
    expect(whiteBackground(image(200, [250, 250, 250], [20, 20, 20]), 200, 200).ok).toBe(true);
    expect(whiteBackground(image(200, [170, 170, 170], [250, 250, 250]), 200, 200).ok).toBe(false);
    expect(whiteBackground(image(200, [40, 90, 200], [250, 250, 250]), 200, 200).ok).toBe(false);
  });
  it("prints the Admin's correction over the portal value", () => {
    expect(corrected("Juan Dela Cruz", "Juan P. Dela Cruz")).toBe("Juan P. Dela Cruz");
    expect(corrected("Juan Dela Cruz", "  ")).toBe("Juan Dela Cruz");
    expect(corrected(null, undefined)).toBe(null);
  });
  it("waits for the photo before printing", () => {
    const facts = { enrollmentStatus: "Enrolled", trainingEnd: "2026-10-08", balanceCentavos: 0, evaluationRequired: false, evaluationOn: null, paidOn: "2026-10-01", cert: null };
    expect(certificateState({ ...facts, photoOnFile: false }, "2026-10-09").state).toBe("Waiting for photo");
    expect(certificateState({ ...facts, photoOnFile: true }, "2026-10-09").state).toBe("Due");
    expect(certificateState(facts, "2026-10-09").state).toBe("Due");
  });
});

import { canSetSeries, isStcwCategory } from "@/lib/certificate-rules";
describe("certificate numbering", () => {
  it("lets the Releasing Officer set In-House numbering, the Admin any", () => {
    expect(isStcwCategory("STCW Courses")).toBe(true);
    expect(isStcwCategory("In-House Training")).toBe(false);
    expect(canSetSeries(["releasing_officer"], false)).toBe(true);
    expect(canSetSeries(["releasing_officer"], true)).toBe(false);
    expect(canSetSeries(["admin"], true)).toBe(true);
    expect(canSetSeries(["cashier"], false)).toBe(false);
  });
});
