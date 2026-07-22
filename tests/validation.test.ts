import { describe, expect, it } from "vitest";
import {
  formatPhMobile,
  isEmail,
  isPhContactNumber,
  isPhMobile,
  isSrn,
  normalizePhLandline,
  normalizePhMobile,
  normalizeSrn,
} from "../lib/validation";

describe("Philippine mobile numbers", () => {
  it("accepts the ways a trainee normally writes one", () => {
    for (const value of [
      "09171234567",
      "0917 123 4567",
      "0917-123-4567",
      "+639171234567",
      "+63 917 123 4567",
      "639171234567",
      "9171234567",
    ]) {
      expect(normalizePhMobile(value), value).toBe("+639171234567");
    }
  });

  it("rejects numbers that are not PH mobiles", () => {
    expect(isPhMobile("08171234567")).toBe(false); // network prefix must start with 9
    expect(isPhMobile("0917123456")).toBe(false); // one digit short
    expect(isPhMobile("091712345678")).toBe(false); // one digit long
    expect(isPhMobile("+14155552671")).toBe(false); // not a PH country code
    expect(isPhMobile("")).toBe(false);
    expect(isPhMobile("not a number")).toBe(false);
  });

  it("formats a stored number back for display", () => {
    expect(formatPhMobile("+639171234567")).toBe("0917 123 4567");
  });
});

describe("Philippine landlines", () => {
  it("accepts Metro Manila and provincial formats", () => {
    expect(normalizePhLandline("(02) 8553 0310")).toBe("+63285530310");
    expect(normalizePhLandline("8553 0310")).toBe("+63285530310");
    expect(normalizePhLandline("02-8553-0310")).toBe("+63285530310");
    expect(normalizePhLandline("(032) 234 5678")).toBe("+63322345678");
  });

  it("treats a landline as a valid contact number but not as a mobile", () => {
    expect(isPhContactNumber("8553 0310")).toBe(true);
    expect(isPhMobile("8553 0310")).toBe(false);
  });

  it("accepts a mobile as a contact number too", () => {
    expect(isPhContactNumber("0917 123 4567")).toBe(true);
  });
});

describe("SRN", () => {
  it("requires exactly ten digits", () => {
    expect(normalizeSrn("1234567890")).toBe("1234567890");
    expect(normalizeSrn("123 456 7890")).toBe("1234567890");
    expect(normalizeSrn("123-456-7890")).toBe("1234567890");
  });

  it("rejects anything that is not ten digits", () => {
    expect(isSrn("123456789")).toBe(false); // nine
    expect(isSrn("12345678901")).toBe(false); // eleven
    expect(isSrn("SRN1234567")).toBe(false); // letters
    expect(isSrn("12345678a0")).toBe(false);
    expect(isSrn("")).toBe(false);
  });
});

describe("email addresses", () => {
  it("accepts ordinary addresses", () => {
    expect(isEmail("name@example.com")).toBe(true);
    expect(isEmail("first.last+tag@sub.example.co.uk")).toBe(true);
    expect(isEmail("  spaced@example.com  ")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isEmail("no-at-sign.example.com")).toBe(false);
    expect(isEmail("two@@example.com")).toBe(false);
    expect(isEmail("trailing.dot.@example.com")).toBe(false);
    expect(isEmail("double..dot@example.com")).toBe(false);
    expect(isEmail("missing@tld")).toBe(false);
    expect(isEmail("missing@.com")).toBe(false);
    expect(isEmail("")).toBe(false);
  });
});
