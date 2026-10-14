import { nanoid } from "nanoid";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { merchants, orders, paymentAttempts, paymentEvents, paymentRequests, receipts, verifiedTransfers } from "../../drizzle/schema";
import { getDb } from "../db";
import { classifyAmount, formatUsdcAmount } from "./amount";
import { verifyUsdcTransfer } from "./solana";
import { assertPaymentTransition } from "./state";
import { appendAuditEvent } from "../security/audit";
import { enqueueWorkflowEvent } from "../workflows/enqueue";

export async function verifyAndSettleSignature(publicId: string, signature: string) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Payment database is unavailable." });
  const [request] = await db.select().from(paymentRequests).where(eq(paymentRequests.publicId, publicId)).limit(1);
  if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Payment request not found." });
  const [alreadyUsed] = await db.select().from(verifiedTransfers).where(eq(verifiedTransfers.transactionSignature, signature)).limit(1);
  if (alreadyUsed) {
    if (alreadyUsed.paymentRequestId === request.id) return { status: request.status, message: "This transaction was already recorded; no second credit was applied." };
    throw new TRPCError({ code: "CONFLICT", message: "This transaction signature has already been credited to another payment request." });
  }
  if (["CONFIRMED", "OVERPAID"].includes(request.status)) {
    await db.update(paymentAttempts).set({ status: "SUPERSEDED", lastCheckedAt: new Date(), failureReason: "This request was already settled by another transfer." }).where(and(eq(paymentAttempts.paymentRequestId, request.id), eq(paymentAttempts.signature, signature), eq(paymentAttempts.status, "VERIFYING")));
    return { status: request.status, message: "This request is already settled or awaiting manual overpayment review. No second credit was applied." };
  }
  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, request.merchantId)).limit(1);
  if (!merchant) throw new TRPCError({ code: "NOT_FOUND", message: "Merchant not found." });
  const [priorAttempt] = await db.select().from(paymentAttempts).where(and(eq(paymentAttempts.paymentRequestId, request.id), eq(paymentAttempts.signature, signature))).limit(1);
  if (priorAttempt?.status === "REJECTED") return { status: "REJECTED" as const, message: priorAttempt.failureReason || "This signature was rejected; submit a different transaction signature." };

  await db.transaction(async tx => {
    const [locked] = await tx.select().from(paymentRequests).where(eq(paymentRequests.id, request.id)).for("update");
    if (!locked) throw new TRPCError({ code: "NOT_FOUND", message: "Payment request not found." });
    if (["CONFIRMED", "OVERPAID"].includes(locked.status)) throw new TRPCError({ code: "CONFLICT", message: "This request is already settled; a second transfer was not credited." });
    const now = new Date();
    const [existingAttempt] = await tx.select().from(paymentAttempts).where(and(eq(paymentAttempts.paymentRequestId, request.id), eq(paymentAttempts.signature, signature))).limit(1);
    if (!existingAttempt) await tx.insert(paymentAttempts).values({ merchantId: merchant.id, paymentRequestId: request.id, signature, status: "VERIFYING", lastCheckedAt: now });
    else await tx.update(paymentAttempts).set({ status: "VERIFYING", failureReason: null, lastCheckedAt: now }).where(eq(paymentAttempts.id, existingAttempt.id));
    const expired = locked.expiresAt <= now || locked.status === "EXPIRED";
    if (!expired && ["AWAITING_PAYMENT", "UNDERPAID", "DETECTED", "FAILED"].includes(locked.status)) {
      assertPaymentTransition(locked.status as never, "VERIFYING");
      await tx.update(paymentRequests).set({ status: "VERIFYING", updatedAt: now }).where(eq(paymentRequests.id, locked.id));
    }
  });

  const verification = await verifyUsdcTransfer({ signature, network: request.network, expectedMint: request.mint, receivingWallet: request.receivingWallet, paymentReference: request.referencePublicKey });
  let observedStatus = request.status;
  if (verification.detected) {
    observedStatus = await db.transaction(async tx => {
      const [locked] = await tx.select().from(paymentRequests).where(eq(paymentRequests.id, request.id)).for("update");
      if (!locked) throw new TRPCError({ code: "NOT_FOUND", message: "Payment request not found." });
      const [attempt] = await tx.select().from(paymentAttempts).where(and(eq(paymentAttempts.paymentRequestId, request.id), eq(paymentAttempts.signature, signature))).for("update");
      if (attempt && !attempt.detectedAt) {
        const detectedAt = new Date();
        await tx.update(paymentAttempts).set({ detectedAt }).where(eq(paymentAttempts.id, attempt.id));
        const [event] = await tx.insert(paymentEvents).values({ merchantId: merchant.id, paymentRequestId: request.id, eventType: "payment_detected", payload: { signature, detectedAt: detectedAt.toISOString(), finalized: verification.outcome === "verified" } }).$returningId();
        await appendAuditEvent(tx, merchant.id, request.id, "payment_detected", { signature, detectedAt, finalized: verification.outcome === "verified" });
        if (event?.id) await enqueueWorkflowEvent(tx, merchant.id, request.id, event.id, "payment_detected");
      }
      if (verification.outcome === "pending" && locked.status === "VERIFYING" && locked.expiresAt > new Date()) {
        assertPaymentTransition("VERIFYING", "DETECTED");
        await tx.update(paymentRequests).set({ status: "DETECTED", updatedAt: new Date() }).where(eq(paymentRequests.id, request.id));
        return "DETECTED" as const;
      }
      return locked.status;
    });
  }

  if (verification.outcome === "pending") {
    const now = new Date();
    await db.update(paymentAttempts).set({ status: "VERIFYING", lastCheckedAt: now, failureReason: verification.reason }).where(and(eq(paymentAttempts.paymentRequestId, request.id), eq(paymentAttempts.signature, signature)));
    const status = observedStatus === "EXPIRED" ? "EXPIRED" as const : observedStatus === "DETECTED" ? "DETECTED" as const : observedStatus === "CONFIRMED" ? "CONFIRMED" as const : "VERIFYING" as const;
    return { status, message: verification.reason };
  }

  if (verification.outcome === "failed") {
    await db.transaction(async tx => {
      const [locked] = await tx.select().from(paymentRequests).where(eq(paymentRequests.id, request.id)).for("update");
      if (!locked) return;
      await tx.update(paymentAttempts).set({ status: "REJECTED", lastCheckedAt: new Date(), failureReason: verification.reason }).where(and(eq(paymentAttempts.paymentRequestId, request.id), eq(paymentAttempts.signature, signature)));
      const expired = locked.expiresAt <= new Date() || locked.status === "EXPIRED";
      if (!expired && locked.status === "VERIFYING") {
        const [existingTransfer] = await tx.select().from(verifiedTransfers).where(eq(verifiedTransfers.paymentRequestId, request.id)).limit(1);
        const fallback = existingTransfer ? "UNDERPAID" : "AWAITING_PAYMENT";
        assertPaymentTransition("VERIFYING", fallback);
        await tx.update(paymentRequests).set({ status: fallback, updatedAt: new Date() }).where(eq(paymentRequests.id, request.id));
      } else if (expired && locked.status !== "EXPIRED") {
        assertPaymentTransition(locked.status as never, "EXPIRED");
        await tx.update(paymentRequests).set({ status: "EXPIRED", updatedAt: new Date() }).where(eq(paymentRequests.id, request.id));
      }
      const [event] = await tx.insert(paymentEvents).values({ merchantId: merchant.id, paymentRequestId: request.id, eventType: "verification_failed", payload: { signature, reason: verification.reason } }).$returningId();
      await appendAuditEvent(tx, merchant.id, request.id, "verification_failed", { signature, reason: verification.reason });
      if (event?.id) await enqueueWorkflowEvent(tx, merchant.id, request.id, event.id, "verification_failed");
    });
    return { status: "REJECTED" as const, message: verification.reason };
  }

  try {
    return await db.transaction(async tx => {
      const [locked] = await tx.select().from(paymentRequests).where(eq(paymentRequests.id, request.id)).for("update");
      if (!locked) throw new TRPCError({ code: "NOT_FOUND", message: "Payment request not found." });
      const [used] = await tx.select().from(verifiedTransfers).where(eq(verifiedTransfers.transactionSignature, signature)).limit(1);
      if (used) {
        if (used.paymentRequestId === request.id) return { status: locked.status, message: "This transaction was already recorded; no second credit was applied." };
        throw new TRPCError({ code: "CONFLICT", message: "This transaction signature has already been credited to another payment request." });
      }
      if (["CONFIRMED", "OVERPAID"].includes(locked.status)) throw new TRPCError({ code: "CONFLICT", message: "This request is already settled; a second transfer was not credited." });
      const previousTransfers = await tx.select().from(verifiedTransfers).where(eq(verifiedTransfers.paymentRequestId, request.id));
      const totalReceived = previousTransfers.reduce((sum, transfer) => sum + BigInt(transfer.amountBaseUnits), 0n) + BigInt(verification.receivedBaseUnits);
      const expired = locked.expiresAt <= new Date() || locked.status === "EXPIRED";
      if (expired) {
        await tx.insert(verifiedTransfers).values({ merchantId: merchant.id, paymentRequestId: request.id, transactionSignature: signature, amountBaseUnits: verification.receivedBaseUnits, mint: verification.mint, receivingWallet: verification.receivingWallet, network: locked.network, acceptedForFulfillment: 0, confirmedAt: verification.confirmedAt });
        if (locked.status !== "EXPIRED") { assertPaymentTransition(locked.status as never, "EXPIRED"); await tx.update(paymentRequests).set({ status: "EXPIRED", updatedAt: new Date() }).where(eq(paymentRequests.id, request.id)); }
        await tx.update(paymentAttempts).set({ status: "LATE_RECEIVED", lastCheckedAt: new Date(), failureReason: "Funds were received after invoice expiry; manual reconciliation required." }).where(and(eq(paymentAttempts.paymentRequestId, request.id), eq(paymentAttempts.signature, signature)));
        await tx.insert(paymentEvents).values({ merchantId: merchant.id, paymentRequestId: request.id, eventType: "late_transfer_detected", payload: { signature, receivedBaseUnits: verification.receivedBaseUnits, acceptedForFulfillment: false } });
        await appendAuditEvent(tx, merchant.id, request.id, "late_transfer_detected", { signature, receivedBaseUnits: verification.receivedBaseUnits });
        return { status: "EXPIRED" as const, message: "A finalized USDC transfer arrived after this invoice expired. It is recorded for manual reconciliation and did not fulfill the order." };
      }
      const classified = classifyAmount(totalReceived, BigInt(locked.amountBaseUnits), locked.overpaymentPolicy);
      const finalStatus = classified.status;
      const fulfilled = classified.fulfill && finalStatus !== "UNDERPAID";
      // A concurrent pending RPC result can move VERIFYING back to DETECTED after this
      // signature was submitted. Since this RPC result is now finalized, re-enter the
      // verification state under the same row lock before applying settlement.
      if (locked.status !== "VERIFYING") {
        assertPaymentTransition(locked.status as never, "VERIFYING");
        await tx.update(paymentRequests).set({ status: "VERIFYING", updatedAt: new Date() }).where(eq(paymentRequests.id, request.id));
      }
      assertPaymentTransition("VERIFYING", finalStatus as never);
      await tx.insert(verifiedTransfers).values({ merchantId: merchant.id, paymentRequestId: request.id, transactionSignature: signature, amountBaseUnits: verification.receivedBaseUnits, mint: verification.mint, receivingWallet: verification.receivingWallet, network: locked.network, acceptedForFulfillment: fulfilled ? 1 : 0, confirmedAt: verification.confirmedAt });
      if (fulfilled) {
        await tx.update(verifiedTransfers).set({ acceptedForFulfillment: 1 }).where(eq(verifiedTransfers.paymentRequestId, request.id));
      }
      await tx.update(paymentRequests).set({ status: finalStatus, updatedAt: new Date() }).where(eq(paymentRequests.id, request.id));
      await tx.update(paymentAttempts).set({ status: finalStatus, lastCheckedAt: new Date(), failureReason: null }).where(and(eq(paymentAttempts.paymentRequestId, request.id), eq(paymentAttempts.signature, signature)));
      const eventType = finalStatus === "UNDERPAID" ? "payment_underpaid" : finalStatus === "OVERPAID" ? "payment_overpaid" : "payment_confirmed";
      const allSignatures = [...previousTransfers.map(transfer => transfer.transactionSignature), signature];
      const [event] = await tx.insert(paymentEvents).values({ merchantId: merchant.id, paymentRequestId: request.id, eventType, payload: { signature, signatures: allSignatures, receivedBaseUnits: verification.receivedBaseUnits, totalReceivedBaseUnits: totalReceived.toString(), acceptedForFulfillment: fulfilled } }).$returningId();
      if (request.orderId) await tx.update(orders).set({ paymentStatus: finalStatus, confirmedSignature: fulfilled ? signature : null, workflowStatus: fulfilled ? "QUEUED" : "NOT_STARTED", updatedAt: new Date() }).where(and(eq(orders.merchantId, merchant.id), eq(orders.publicOrderId, request.orderId)));
      if (fulfilled) {
        const receiptNumber = `LEXI-${nanoid(10).toUpperCase()}`;
        const explorerUrl = (transferSignature: string) => `https://explorer.solana.com/tx/${transferSignature}${locked.network === "devnet" ? "?cluster=devnet" : ""}`;
        const receiptTransfers = [...previousTransfers, { transactionSignature: signature, amountBaseUnits: verification.receivedBaseUnits, confirmedAt: verification.confirmedAt }].map(transfer => ({ transactionSignature: transfer.transactionSignature, amountBaseUnits: transfer.amountBaseUnits, amount: formatUsdcAmount(transfer.amountBaseUnits), confirmedAt: transfer.confirmedAt.toISOString(), explorerUrl: explorerUrl(transfer.transactionSignature) }));
        const snapshot = { receiptNumber, merchant: merchant.displayName, paymentRequestId: request.publicId, orderReference: request.orderId, description: request.description, amount: formatUsdcAmount(totalReceived.toString()), amountBaseUnits: totalReceived.toString(), token: "USDC", network: locked.network, transactionSignature: signature, transactionSignatures: allSignatures, transfers: receiptTransfers, receivingWallet: locked.receivingWallet, confirmedAt: verification.confirmedAt.toISOString(), verificationStatus: "CONFIRMED", receiptCreatedAt: new Date().toISOString(), explorerUrl: explorerUrl(signature) };
        await tx.insert(receipts).values({ merchantId: merchant.id, paymentRequestId: request.id, receiptNumber, snapshot });
      }
      await appendAuditEvent(tx, merchant.id, request.id, fulfilled ? "payment_verified" : "payment_underpaid", { signature, signatures: allSignatures, totalReceivedBaseUnits: totalReceived.toString(), status: finalStatus, fulfillment: fulfilled });
      if (event?.id && fulfilled) await enqueueWorkflowEvent(tx, merchant.id, request.id, event.id, "payment_confirmed");
      else if (event?.id && finalStatus === "UNDERPAID") await enqueueWorkflowEvent(tx, merchant.id, request.id, event.id, "payment_underpaid");
      return { status: finalStatus, message: fulfilled ? "Finalized transfer verified. Receipt and workflow actions have been recorded." : finalStatus === "UNDERPAID" ? "The transfer is finalized but the total received is below the invoice amount. The order remains unpaid." : "Overpayment recorded under the invoice policy; no refund was initiated." };
    });
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    await db.update(paymentAttempts).set({ status: "REJECTED", lastCheckedAt: new Date(), failureReason: "Duplicate signature or concurrent settlement prevented credit." }).where(and(eq(paymentAttempts.paymentRequestId, request.id), eq(paymentAttempts.signature, signature)));
    throw new TRPCError({ code: "CONFLICT", message: "This transaction could not be credited because it may already have been applied." });
  }
}
