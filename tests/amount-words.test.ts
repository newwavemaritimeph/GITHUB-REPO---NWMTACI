import { describe, expect, it } from "vitest";
import { pesosInWords } from "@/lib/amount-words";
import { hasDriveScope } from "@/lib/google-classroom";

describe("amount in words", () => {
  it("writes pesos and centavos for vouchers", () => {
    expect(pesosInWords(1845075)).toBe("Eighteen thousand four hundred fifty pesos and 75/100 only");
    expect(pesosInWords(100)).toBe("One peso only");
    expect(pesosInWords(123456700)).toBe("One million two hundred thirty-four thousand five hundred sixty-seven pesos only");
    expect(pesosInWords(5)).toBe("Zero pesos and 05/100 only");
  });
});

describe("Google Drive permission", () => {
  it("finds drive.file among the granted scopes", () => {
    expect(hasDriveScope("openid email https://www.googleapis.com/auth/classroom.rosters https://www.googleapis.com/auth/drive.file")).toBe(true);
    expect(hasDriveScope("openid email https://www.googleapis.com/auth/classroom.rosters")).toBe(false);
  });
});
