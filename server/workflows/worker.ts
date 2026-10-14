import { createHmac } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { merchantSettings, merchants, notificationAttempts, orders, paymentAttempts, paymentEvents, paymentRequests, receipts, webhookDeliveries, webhookEndpoints, workflowExecutions } from "../../drizzle/schema";
import { getDb } from "../db";
import { appendAuditEvent } from "../security/audit";
import { decryptSecret } from "../security/secretBox";
import { postSafeWebhook } from "../security/webhookTarget";
import { formatUsdcAmount } from "../payments/amount";
import { verifyAndSettleSignature } from "../payments/settlement";
import { enqueueWorkflowEvent } from "./enqueue";

type Action = { kind: string; config?: Record<string, unknown> | null; status?: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED"; error?: string };
let interval: NodeJS.Timeout | undefined;
let reconciliationInterval: NodeJS.Timeout | undefined;
let busy = false;
let reconciling = false;

function publicBaseUrl(): string {
  const value = process.env.LEXI_PUBLIC_URL;
  if (!value) throw new Error("LEXI_PUBLIC_URL is not configured; external notification links are unavailable.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("LEXI_PUBLIC_URL must be an HTTPS origin without credentials or fragments.");
  return url.origin;
}

async function notifyTelegram(merchantId: number, text: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");
  const [settings] = await db.select().from(merchantSettings).where(eq(merchantSettings.merchantId, merchantId)).limit(1);
  const token = settings?.telegramBotTokenEncrypted ? decryptSecret(settings.telegramBotTokenEncrypted) : process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !settings?.telegramChatId) throw new Error("Telegram bot token or chat ID is not configured.");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: settings.telegramChatId, text }), signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Telegram delivery failed with HTTP ${response.status}.`);
}

async function notifyEmail(merchantId: number, subject: string, text: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");
  const [settings] = await db.select().from(merchantSettings).where(eq(merchantSettings.merchantId, merchantId)).limit(1);
  const token = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!token || !from || !settings?.email) throw new Error("Resend API key, verified sender address, or merchant email is not configured.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [settings.email], subject, text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Email delivery failed with HTTP ${response.status}.`);
}

async function deliverWebhooks(executionId: number, merchantId: number, eventType: string, payload: Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");
  const endpoints = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.merchantId, merchantId), eq(webhookEndpoints.enabled, 1)));
  const subscribed = endpoints.filter(endpoint => endpoint.subscriptions.includes(eventType));
  if (!subscribed.length) throw new Error("No enabled webhook endpoint subscribes to this event.");
  for (const endpoint of subscribed) {
    const idempotencyKey = `workflow:${executionId}:webhook:${endpoint.id}`;
    const [existing] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.idempotencyKey, idempotencyKey)).limit(1);
    if (existing?.status === "DELIVERED") continue;
    const [deliveryId] = existing ? [{ id: existing.id }] : await db.insert(webhookDeliveries).values({ merchantId, endpointId: endpoint.id, eventId: executionId, idempotencyKey, status: "QUEUED" }).$returningId();
    if (!deliveryId?.id) throw new Error("Webhook delivery record could not be created.");
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ id: idempotencyKey, type: eventType, createdAt: new Date().toISOString(), data: payload });
    try {
      const secret = decryptSecret(endpoint.secretEncrypted);
      const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
      const response = await postSafeWebhook(endpoint.url, { "content-type": "application/json", "x-lexi-timestamp": timestamp, "x-lexi-signature": `sha256=${signature}`, "idempotency-key": idempotencyKey }, body);
      await db.update(webhookDeliveries).set({ status: "DELIVERED", attempts: (existing?.attempts ?? 0) + 1, responseCode: response.statusCode, lastError: null }).where(eq(webhookDeliveries.id, deliveryId.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook delivery failed.";
      await db.update(webhookDeliveries).set({ status: "FAILED", attempts: (existing?.attempts ?? 0) + 1, lastError: message }).where(eq(webhookDeliveries.id, deliveryId.id));
      throw new Error(message);
    }
  }
}

async function performAction(action: Action, execution: typeof workflowExecutions.$inferSelect, actionIndex: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable.");
  const [request] = await db.select().from(paymentRequests).where(and(eq(paymentRequests.id, execution.paymentRequestId), eq(paymentRequests.merchantId, execution.merchantId))).limit(1);
  if (!request) throw new Error("Payment request not found.");
  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, execution.merchantId)).limit(1);
  if (!merchant) throw new Error("Merchant not found.");
  const notificationSubject: Record<string, string> = {
    request_created: "Payment request created",
    payment_detected: "Payment detected — verification pending",
    payment_confirmed: "Payment received — verified by LEXI",
    payment_underpaid: "Payment underpaid",
    payment_expired: "Payment request expired",
    verification_failed: "Payment verification failed",
  };
  const message = async () => {
    const [receipt] = await db.select().from(receipts).where(eq(receipts.paymentRequestId, request.id)).limit(1);
    const receiptLink = receipt ? ` Verified receipt: ${publicBaseUrl()}/receipt/${request.publicId}.` : "";
    return `${merchant.displayName}: ${request.description} — ${formatUsdcAmount(request.amountBaseUnits)} USDC. Status: ${request.status}. Payment: ${publicBaseUrl()}/pay/${request.publicId}.${receiptLink}`;
  };
  switch (action.kind) {
    case "create_receipt": {
      const [receipt] = await db.select().from(receipts).where(eq(receipts.paymentRequestId, request.id)).limit(1);
      if (!receipt) throw new Error("Confirmed receipt was not found.");
      return "Receipt already created at settlement; no duplicate receipt was generated.";
    }
    case "mark_order_paid": {
      if (request.status !== "CONFIRMED" && request.status !== "OVERPAID") throw new Error("Order cannot be fulfilled before amount-satisfied settlement.");
      if (request.orderId) await db.update(orders).set({ paymentStatus: request.status, workflowStatus: "SUCCEEDED" }).where(and(eq(orders.merchantId, merchant.id), eq(orders.publicOrderId, request.orderId)));
      return "Order settlement status was committed with verified payment.";
    }
    case "record_event": {
      const idempotencyKey = `workflow:${execution.id}:action:${actionIndex}`;
      await db.insert(paymentEvents).values({ merchantId: execution.merchantId, paymentRequestId: request.id, eventType: "workflow_action_recorded", idempotencyKey, payload: { idempotencyKey, workflowExecutionId: execution.id, workflowId: execution.workflowId, actionIndex, trigger: execution.eventType, requestStatus: request.status } }).onDuplicateKeyUpdate({ set: { idempotencyKey } });
      return "Workflow action recorded once in merchant payment history.";
    }
    case "redirect":
      if (request.status !== "CONFIRMED" && request.status !== "OVERPAID") throw new Error("Redirect requires confirmed settlement.");
      if (!request.redirectUrl) throw new Error("This payment request has no validated HTTPS success redirect configured.");
      return "The public checkout redirects only after it receives the verified amount-satisfied settlement status.";
    case "telegram": {
      await notifyTelegram(merchant.id, await message());
      await db.insert(notificationAttempts).values({ merchantId: merchant.id, workflowExecutionId: execution.id, channel: "telegram", status: "SENT", attempts: execution.attempts });
      return "Telegram delivered.";
    }
    case "email": {
      await notifyEmail(merchant.id, notificationSubject[execution.eventType] ?? "LEXI payment update", await message());
      await db.insert(notificationAttempts).values({ merchantId: merchant.id, workflowExecutionId: execution.id, channel: "email", status: "SENT", attempts: execution.attempts });
      return "Email delivered.";
    }
    case "webhook":
      await deliverWebhooks(execution.id, merchant.id, execution.eventType, { paymentId: request.publicId, requestStatus: request.status, amountBaseUnits: request.amountBaseUnits, orderId: request.orderId });
      return "Signed merchant webhook delivered.";
    default:
      throw new Error("Unknown workflow action.");
  }
}

async function expireDueRequests() {
  const db = await getDb();
  if (!db) return;
  const now = new Date();
  const due = await db.select().from(paymentRequests).where(and(lte(paymentRequests.expiresAt, now), inArray(paymentRequests.status, ["CREATED", "AWAITING_PAYMENT", "DETECTED", "VERIFYING", "UNDERPAID"]))).orderBy(asc(paymentRequests.expiresAt)).limit(100);
  for (const candidate of due) {
    await db.transaction(async tx => {
      const [request] = await tx.select().from(paymentRequests).where(eq(paymentRequests.id, candidate.id)).for("update");
      if (!request || request.expiresAt > now || !["CREATED", "AWAITING_PAYMENT", "DETECTED", "VERIFYING", "UNDERPAID"].includes(request.status)) return;
      await tx.update(paymentRequests).set({ status: "EXPIRED", updatedAt: now }).where(eq(paymentRequests.id, request.id));
      const [event] = await tx.insert(paymentEvents).values({ merchantId: request.merchantId, paymentRequestId: request.id, eventType: "payment_expired", payload: { publicId: request.publicId, expiredAt: now.toISOString(), priorStatus: request.status } }).$returningId();
      await appendAuditEvent(tx, request.merchantId, request.id, "payment_expired", { priorStatus: request.status, expiredAt: now.toISOString() });
      if (event?.id) await enqueueWorkflowEvent(tx, request.merchantId, request.id, event.id, "payment_expired");
    });
  }
}

async function claimJob() {
  const db = await getDb();
  if (!db) return null;
  return db.transaction(async tx => {
    const now = new Date();
    const [job] = await tx.select().from(workflowExecutions).where(or(
      and(eq(workflowExecutions.status, "QUEUED"), lte(workflowExecutions.availableAt, now)),
      and(eq(workflowExecutions.status, "RUNNING"), lte(workflowExecutions.leaseUntil, now)),
    )).orderBy(asc(workflowExecutions.availableAt)).limit(1).for("update");
    if (!job) return null;
    const recovered = job.status === "RUNNING";
    const actions = (Array.isArray(job.actions) ? job.actions as Action[] : []).map(action => action.status === "RUNNING" ? { ...action, status: "FAILED" as const, error: "Worker lease expired during this action; an external delivery may have been accepted and could repeat on retry. Payment credit and order/receipt settlement remain idempotent; webhook receivers should deduplicate the stable delivery key." } : action);
    const updated = { ...job, status: "RUNNING" as const, actions, attempts: job.attempts + 1 };
    await tx.update(workflowExecutions).set({ status: "RUNNING", actions, attempts: updated.attempts, leaseUntil: new Date(now.getTime() + 60_000), updatedAt: now, lastError: recovered ? "Recovered expired worker lease; successful actions remain skipped." : job.lastError }).where(eq(workflowExecutions.id, job.id));
    return updated;
  });
}

async function reconcileOnePendingAttempt() {
  const db = await getDb();
  if (!db) return;
  const configuredInterval = Number(process.env.SOLANA_RECONCILE_INTERVAL_MS);
  const intervalMs = Number.isFinite(configuredInterval) && configuredInterval >= 5_000 && configuredInterval <= 120_000 ? configuredInterval : 15_000;
  const now = new Date();
  const cutoff = new Date(now.getTime() - intervalMs);
  const attempt = await db.transaction(async tx => {
    const [candidate] = await tx.select().from(paymentAttempts).where(and(
      eq(paymentAttempts.status, "VERIFYING"),
      isNotNull(paymentAttempts.signature),
      or(isNull(paymentAttempts.lastCheckedAt), lt(paymentAttempts.lastCheckedAt, cutoff)),
    )).orderBy(asc(paymentAttempts.lastCheckedAt), asc(paymentAttempts.createdAt)).limit(1).for("update");
    if (!candidate?.signature) return null;
    await tx.update(paymentAttempts).set({ lastCheckedAt: now }).where(eq(paymentAttempts.id, candidate.id));
    return candidate;
  });
  if (!attempt?.signature) return;
  const [request] = await db.select().from(paymentRequests).where(and(eq(paymentRequests.id, attempt.paymentRequestId), eq(paymentRequests.merchantId, attempt.merchantId))).limit(1);
  if (!request) {
    await db.update(paymentAttempts).set({ status: "REJECTED", failureReason: "Payment request no longer exists; reconciliation stopped." }).where(eq(paymentAttempts.id, attempt.id));
    return;
  }
  try {
    await verifyAndSettleSignature(request.publicId, attempt.signature);
  } catch (error) {
    const [currentRequest] = await db.select().from(paymentRequests).where(eq(paymentRequests.id, request.id)).limit(1);
    if (currentRequest && ["CONFIRMED", "OVERPAID"].includes(currentRequest.status)) {
      await db.update(paymentAttempts).set({ status: "SUPERSEDED", failureReason: "Another transfer settled this request before this attempt was verified." }).where(eq(paymentAttempts.id, attempt.id));
    } else {
      console.warn("[Solana reconciliation] Attempt remains pending", error instanceof Error ? error.message : "unknown error");
    }
  }
}

async function runOneJob() {
  await expireDueRequests();
  const job = await claimJob();
  if (!job) return;
  const actions = Array.isArray(job.actions) ? job.actions as Action[] : [];
  let failed = false;
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    if (action.status === "SUCCEEDED") continue;
    action.status = "RUNNING";
    const db = await getDb();
    if (!db) return;
    await db.update(workflowExecutions).set({ actions, updatedAt: new Date() }).where(eq(workflowExecutions.id, job.id));
    try {
      const result = await performAction(action, job, index);
      actions[index] = { ...action, status: "SUCCEEDED", error: undefined, config: { ...(action.config ?? {}), result } };
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : "Action failed.";
      actions[index] = { ...action, status: "FAILED", error: message };
      if (action.kind === "telegram" || action.kind === "email") {
        await db.insert(notificationAttempts).values({ merchantId: job.merchantId, workflowExecutionId: job.id, channel: action.kind, status: "FAILED", attempts: job.attempts, error: message });
      }
    }
    await db.update(workflowExecutions).set({ actions, updatedAt: new Date() }).where(eq(workflowExecutions.id, job.id));
  }
  const db = await getDb();
  if (!db) return;
  const attemptLimit = 4;
  if (failed && job.attempts < attemptLimit) {
    const delayMs = Math.min(60_000, 2_000 * 2 ** (job.attempts - 1));
    await db.update(workflowExecutions).set({ status: "QUEUED", actions, lastError: "One or more workflow actions failed.", availableAt: new Date(Date.now() + delayMs), leaseUntil: null, updatedAt: new Date() }).where(eq(workflowExecutions.id, job.id));
  } else {
    const status = failed ? "DEAD_LETTER" : "SUCCEEDED";
    await db.update(workflowExecutions).set({ status, actions, lastError: failed ? "Workflow exhausted its bounded retry attempts." : null, leaseUntil: null, updatedAt: new Date() }).where(eq(workflowExecutions.id, job.id));
    if (job.workflowId) await db.update(orders).set({ workflowStatus: status }).where(and(eq(orders.merchantId, job.merchantId), eq(orders.paymentRequestId, job.paymentRequestId)));
  }
}

export function startWorkflowWorker() {
  if (interval) return;
  interval = setInterval(() => {
    if (busy) return;
    busy = true;
    void runOneJob().catch(error => console.warn("[Workflow worker] Job cycle failed", error instanceof Error ? error.message : "unknown error")).finally(() => { busy = false; });
  }, 2_000);
  interval.unref();
  reconciliationInterval = setInterval(() => {
    if (reconciling) return;
    reconciling = true;
    void reconcileOnePendingAttempt().catch(error => console.warn("[Solana reconciliation] Poll failed", error instanceof Error ? error.message : "unknown error")).finally(() => { reconciling = false; });
  }, 5_000);
  reconciliationInterval.unref();
}
