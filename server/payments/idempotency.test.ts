import { describe, expect, it } from "vitest";
import { paymentIntentFingerprint, type PaymentIntentFingerprintInput } from "./idempotency";

const intent: PaymentIntentFingerprintInput = {
  amountBaseUnits: "1050000", description: "Design work", orderId: "INV-100", customerReference: "client-a",
  network: "devnet", receivingWallet: "8i7vU2YXgYpER9xjM2DKx6M8uJz7PqJQ5YZQ5H7Qn8s1", expiresInHours: 24,
  overpaymentPolicy: "reject", redirectUrl: null, workflowId: null,
};

describe("payment request idempotency fingerprint", () => {
  it("is deterministic for identical normalized invoice terms", () => {
    expect(paymentIntentFingerprint(intent)).toBe(paymentIntentFingerprint({ ...intent }));
  });
  it("changes when any material payment term changes", () => {
    expect(paymentIntentFingerprint(intent)).not.toBe(paymentIntentFingerprint({ ...intent, amountBaseUnits: "1050001" }));
    expect(paymentIntentFingerprint(intent)).not.toBe(paymentIntentFingerprint({ ...intent, receivingWallet: "AnotherWalletPublicAddress" }));
  });
});
