import type { PaymentStatus } from "@shared/lexi";

const transitions: Record<PaymentStatus, readonly PaymentStatus[]> = {
  CREATED: ["AWAITING_PAYMENT", "EXPIRED", "FAILED"],
  AWAITING_PAYMENT: ["DETECTED", "VERIFYING", "EXPIRED", "FAILED"],
  DETECTED: ["VERIFYING", "EXPIRED", "REJECTED", "FAILED"],
  VERIFYING: ["DETECTED", "CONFIRMED", "UNDERPAID", "OVERPAID", "EXPIRED", "FAILED", "REJECTED", "AWAITING_PAYMENT"],
  UNDERPAID: ["DETECTED", "VERIFYING", "EXPIRED", "REJECTED"],
  OVERPAID: ["CONFIRMED", "REJECTED"],
  EXPIRED: ["DETECTED", "VERIFYING", "REJECTED"],
  CONFIRMED: [],
  FAILED: ["VERIFYING", "REJECTED"],
  REJECTED: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return transitions[from].includes(to);
}

export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) throw new Error(`Illegal payment state transition: ${from} -> ${to}`);
}

export function allowedTransitions(from: PaymentStatus): readonly PaymentStatus[] {
  return transitions[from];
}
