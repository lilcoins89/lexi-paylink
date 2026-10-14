import { describe, expect, it } from "vitest";
import { classifyAmount, formatUsdcAmount, parseUsdcAmount } from "./amount";
import { assertPaymentTransition, canTransition } from "./state";

describe("USDC integer amounts", () => {
  it("parses and formats exact six-decimal base units", () => {
    expect(parseUsdcAmount("25.000001")).toBe("25000001");
    expect(formatUsdcAmount("25000001")).toBe("25.000001");
  });
  it("rejects float-like precision beyond the mint decimals", () => {
    expect(() => parseUsdcAmount("0.0000001")).toThrow();
    expect(() => parseUsdcAmount("0")).toThrow();
  });
  it("never fulfills a partial amount and applies the stored overpayment policy", () => {
    expect(classifyAmount(9n, 10n, "accept").fulfill).toBe(false);
    expect(classifyAmount(11n, 10n, "reject").fulfill).toBe(false);
    expect(classifyAmount(11n, 10n, "accept").fulfill).toBe(true);
  });
});

describe("payment state machine", () => {
  it("requires verification before confirmation", () => {
    expect(canTransition("AWAITING_PAYMENT", "CONFIRMED")).toBe(false);
    expect(canTransition("AWAITING_PAYMENT", "OVERPAID")).toBe(false);
    expect(canTransition("VERIFYING", "DETECTED")).toBe(true);
    expect(canTransition("DETECTED", "VERIFYING")).toBe(true);
    expect(canTransition("DETECTED", "CONFIRMED")).toBe(false);
    expect(canTransition("VERIFYING", "CONFIRMED")).toBe(true);
    expect(canTransition("VERIFYING", "OVERPAID")).toBe(true);
    expect(() => assertPaymentTransition("CONFIRMED", "AWAITING_PAYMENT")).toThrow();
  });
  it("allows a cumulative verified partial-payment total to settle", () => {
    expect(canTransition("UNDERPAID", "VERIFYING")).toBe(true);
    expect(canTransition("VERIFYING", "CONFIRMED")).toBe(true);
    expect(canTransition("VERIFYING", "OVERPAID")).toBe(true);
    expect(canTransition("UNDERPAID", "FAILED")).toBe(false);
  });
});
