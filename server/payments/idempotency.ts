import { createHash } from "node:crypto";
import type { SolanaNetwork } from "@shared/lexi";

export type PaymentIntentFingerprintInput = {
  amountBaseUnits: string;
  description: string;
  orderId: string | null;
  customerReference: string | null;
  network: SolanaNetwork;
  receivingWallet: string;
  expiresInHours: number;
  overpaymentPolicy: "reject" | "accept";
  redirectUrl: string | null;
  workflowId: number | null;
};

export function paymentIntentFingerprint(input: PaymentIntentFingerprintInput): string {
  const canonical = JSON.stringify({
    amountBaseUnits: input.amountBaseUnits,
    description: input.description,
    orderId: input.orderId,
    customerReference: input.customerReference,
    network: input.network,
    receivingWallet: input.receivingWallet,
    expiresInHours: input.expiresInHours,
    overpaymentPolicy: input.overpaymentPolicy,
    redirectUrl: input.redirectUrl,
    workflowId: input.workflowId,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
