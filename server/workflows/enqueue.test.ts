import { describe, expect, it } from "vitest";
import { shouldSkipForVerification } from "./enqueue";

describe("verified-only workflow event gating", () => {
  it("does not suppress request-created, detected, expired, or verification-failed triggers", () => {
    for (const trigger of ["request_created", "payment_detected", "payment_expired", "verification_failed"] as const) {
      expect(shouldSkipForVerification(trigger, true, false)).toBe(false);
    }
  });
  it("requires a verified transfer for amount-relevant confirmed and underpaid events", () => {
    expect(shouldSkipForVerification("payment_confirmed", true, false)).toBe(true);
    expect(shouldSkipForVerification("payment_underpaid", true, false)).toBe(true);
    expect(shouldSkipForVerification("payment_confirmed", true, true)).toBe(false);
    expect(shouldSkipForVerification("payment_underpaid", true, true)).toBe(false);
  });
  it("allows merchants to explicitly disable the additional evidence condition", () => {
    expect(shouldSkipForVerification("payment_confirmed", false, false)).toBe(false);
  });
});
