import { and, asc, eq } from "drizzle-orm";
import type { WorkflowTrigger } from "@shared/lexi";
import { paymentEvents, paymentRequests, verifiedTransfers, workflowActions, workflowExecutions, workflows } from "../../drizzle/schema";

export function shouldSkipForVerification(eventType: WorkflowTrigger, verifiedOnly: boolean, hasVerifiedTransfer: boolean): boolean {
  return verifiedOnly && ["payment_confirmed", "payment_underpaid"].includes(eventType) && !hasVerifiedTransfer;
}

// Accepts either the database handle or a transaction handle; both implement this query surface.
export async function enqueueWorkflowEvent(executor: any, merchantId: number, paymentRequestId: number, paymentEventId: number, eventType: WorkflowTrigger) {
  const [request] = await executor.select().from(paymentRequests).where(and(eq(paymentRequests.id, paymentRequestId), eq(paymentRequests.merchantId, merchantId))).limit(1);
  const [event] = await executor.select().from(paymentEvents).where(and(eq(paymentEvents.id, paymentEventId), eq(paymentEvents.paymentRequestId, paymentRequestId), eq(paymentEvents.merchantId, merchantId))).limit(1);
  if (!request || !event) return;
  const enabled = await executor.select().from(workflows).where(and(eq(workflows.merchantId, merchantId), eq(workflows.trigger, eventType), eq(workflows.enabled, 1)));
  const applicable = enabled.filter((workflow: { id: number }) => eventType !== "payment_confirmed" || !request.workflowId || workflow.id === request.workflowId);
  for (const workflow of applicable) {
    const condition = (workflow.conditionJson ?? {}) as { verifiedOnly?: boolean; requireOrderId?: boolean };
    if (condition.requireOrderId && !request.orderId) continue;
    const transfers = await executor.select({ acceptedForFulfillment: verifiedTransfers.acceptedForFulfillment }).from(verifiedTransfers).where(and(eq(verifiedTransfers.paymentRequestId, paymentRequestId), eq(verifiedTransfers.merchantId, merchantId)));
    if (shouldSkipForVerification(eventType, condition.verifiedOnly !== false, transfers.length > 0)) continue;
    if (eventType === "payment_confirmed" && (!(request.status === "CONFIRMED" || request.status === "OVERPAID") || !transfers.some((transfer: { acceptedForFulfillment: number }) => transfer.acceptedForFulfillment === 1))) continue;
    if (eventType === "payment_underpaid" && request.status !== "UNDERPAID") continue;
    if (eventType === "payment_expired" && request.status !== "EXPIRED") continue;
    const actions = await executor.select().from(workflowActions).where(and(eq(workflowActions.workflowId, workflow.id), eq(workflowActions.merchantId, merchantId))).orderBy(asc(workflowActions.sortOrder));
    if (!actions.length) continue;
    const idempotencyKey = `event:${paymentEventId}:workflow:${workflow.id}`;
    await executor.insert(workflowExecutions).values({
      merchantId, paymentRequestId, workflowId: workflow.id, idempotencyKey, eventType,
      status: "QUEUED", actions: actions.map((action: { kind: string; config: unknown }) => ({ kind: action.kind, config: action.config, status: "QUEUED" })),
    }).onDuplicateKeyUpdate({ set: { idempotencyKey } });
  }
}
