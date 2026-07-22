import { describe, expect, it } from "vitest";
import { findPaymentReference } from "../lib/payment-reference";

describe("cashier payment reference reading", () => {
  it("prefers labelled screenshot references", () => {
    expect(findPaymentReference("GCash payment successful\nReference No. 1234567890123")).toBe("1234567890123");
    expect(findPaymentReference("Transaction ID: ABCD-99887766")).toBe("ABCD-99887766");
  });

  it("allows a blank OCR result so the cashier can enter it manually", () => {
    expect(findPaymentReference("Payment successful, thank you.")).toBe("");
  });
});
