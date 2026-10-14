import { randomBytes, createHash } from "node:crypto";
import { CreateRequestSchema, SettingsSchema, SubmitSignatureSchema, WorkflowDraftSchema } from "@shared/lexi";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { Keypair, PublicKey } from "@solana/web3.js";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  auditEvents,
  merchants,
  merchantSettings,
  notificationAttempts,
  orders,
  paymentAttempts,
  paymentEvents,
  paymentRequests,
  receipts,
  verifiedTransfers,
  webhookEndpoints,
  workflowActions,
  workflowExecutions,
  workflows,
} from "../drizzle/schema";
import { getDb } from "./db";
import { getOrCreateMerchant } from "./merchant";
import { formatUsdcAmount, parseUsdcAmount } from "./payments/amount";
import { paymentIntentFingerprint } from "./payments/idempotency";
import { OFFICIAL_USDC_MINT } from "./payments/solana";
import { verifyAndSettleSignature } from "./payments/settlement";
import { appendAuditEvent } from "./security/audit";
import { encryptSecret } from "./security/secretBox";
import { enforceRateLimit } from "./security/rateLimit";
import { sanitizePublicRedirect } from "./security/redirect";
import { assertSafeWebhookUrl } from "./security/webhookTarget";
import { inspectPayboxConnection, payboxIntegrationBoundary } from "./integrations/paybox";
import { COOKIE_NAME as SESSION_COOKIE } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { draftWorkflowFromText, simulateWorkflow } from "./workflows/engine";
import { enqueueWorkflowEvent } from "./workflows/enqueue";

function publicError(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

function validateWallet(address: string): string {
  try { return new PublicKey(address).toBase58(); }
  catch { return publicError("Enter a valid Solana wallet address."); }
}

function validateRedirect(value: string | undefined): string | null {
  try { return sanitizePublicRedirect(value); }
  catch (error) { return publicError(error instanceof Error ? error.message : "Enter a valid HTTPS success URL."); }
}

async function merchantFor(openId: string, name?: string | null) {
  try { return await getOrCreateMerchant(openId, name); }
  catch (error) { throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error instanceof Error ? error.message : "Merchant profile unavailable." }); }
}

function statusLabel(status: string) {
  if (["CREATED", "AWAITING_PAYMENT", "DETECTED", "VERIFYING"].includes(status)) return "pending";
  return status.toLowerCase();
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  dashboard: router({
    stats: protectedProcedure.query(async ({ ctx }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      const requests = await db.select().from(paymentRequests).where(eq(paymentRequests.merchantId, merchant.id)).orderBy(desc(paymentRequests.createdAt));
      const transfers = await db.select().from(verifiedTransfers).where(eq(verifiedTransfers.merchantId, merchant.id));
      const pendingAttempts = await db.select({ id: paymentAttempts.id }).from(paymentAttempts).where(and(eq(paymentAttempts.merchantId, merchant.id), inArray(paymentAttempts.status, ["VERIFYING", "DETECTED"]))).limit(1000);
      const executions = await db.select().from(workflowExecutions).where(eq(workflowExecutions.merchantId, merchant.id)).orderBy(desc(workflowExecutions.createdAt)).limit(6);
      const failures = await db.select().from(workflowExecutions).where(and(eq(workflowExecutions.merchantId, merchant.id), inArray(workflowExecutions.status, ["FAILED", "DEAD_LETTER"])));
      const count = (status: string) => requests.filter(request => statusLabel(request.status) === status).length;
      const confirmedRequests = requests.filter(request => request.status === "CONFIRMED" || request.status === "OVERPAID" && transfers.some(transfer => transfer.paymentRequestId === request.id && transfer.acceptedForFulfillment === 1)).length;
      const volume = transfers.filter(transfer => transfer.acceptedForFulfillment === 1).reduce((sum, transfer) => sum + BigInt(transfer.amountBaseUnits), 0n);
      return {
        merchant: { id: merchant.id, name: merchant.displayName },
        totalVolumeBaseUnits: volume.toString(),
        requestCount: requests.length,
        confirmed: count("confirmed"),
        pending: requests.filter(request => ["CREATED", "AWAITING_PAYMENT", "DETECTED", "VERIFYING"].includes(request.status)).length,
        pendingReconciliation: pendingAttempts.length,
        expired: count("expired"),
        underpaid: count("underpaid"),
        failed: requests.filter(request => ["FAILED", "REJECTED"].includes(request.status)).length,
        conversionRate: requests.length ? Math.round((confirmedRequests / requests.length) * 1000) / 10 : 0,
        recent: requests.slice(0, 6).map(request => ({ ...request, amount: formatUsdcAmount(request.amountBaseUnits) })),
        executions,
        workflowFailures: failures.length,
      };
    }),
  }),
  payments: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      return db.select().from(paymentRequests).where(eq(paymentRequests.merchantId, merchant.id)).orderBy(desc(paymentRequests.createdAt)).limit(100);
    }),
    create: protectedProcedure.input(CreateRequestSchema).mutation(async ({ ctx, input }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      const amountBaseUnits = parseUsdcAmount(input.amount);
      const wallet = validateWallet(input.receivingWallet);
      const mint = OFFICIAL_USDC_MINT[input.network];
      const redirectUrl = validateRedirect(input.redirectUrl);
      const idempotencyPayloadHash = paymentIntentFingerprint({ amountBaseUnits, description: input.description, orderId: input.orderId || null, customerReference: input.customerReference || null, network: input.network, receivingWallet: wallet, expiresInHours: input.expiresInHours, overpaymentPolicy: input.overpaymentPolicy, redirectUrl: redirectUrl || null, workflowId: input.workflowId ?? null });
      const publicId = nanoid(32);
      const referencePublicKey = Keypair.generate().publicKey.toBase58();
      const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);
      const created = await db.transaction(async tx => {
        await tx.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, merchant.id)).for("update");
        const [retry] = await tx.select().from(paymentRequests).where(and(eq(paymentRequests.merchantId, merchant.id), eq(paymentRequests.idempotencyKey, input.idempotencyKey))).limit(1);
        if (retry) {
          if (retry.idempotencyPayloadHash !== idempotencyPayloadHash) throw new TRPCError({ code: "CONFLICT", message: "This idempotency key was already used with different invoice terms. Use a new key for a new request." });
          return retry;
        }
        if (input.workflowId) {
          const [workflow] = await tx.select().from(workflows).where(and(eq(workflows.id, input.workflowId), eq(workflows.merchantId, merchant.id))).limit(1);
          if (!workflow || workflow.trigger !== "payment_confirmed" || workflow.enabled !== 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Select an enabled payment-confirmed workflow owned by this merchant." });
          const selectedActions = await tx.select().from(workflowActions).where(and(eq(workflowActions.workflowId, workflow.id), eq(workflowActions.merchantId, merchant.id)));
          if (selectedActions.some(action => action.kind === "redirect") && !redirectUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "This workflow includes a redirect action; configure its HTTPS success URL on the payment request." });
        }
        if (input.orderId) {
          const [existingOrder] = await tx.select().from(orders).where(and(eq(orders.merchantId, merchant.id), eq(orders.publicOrderId, input.orderId))).limit(1);
          if (existingOrder) throw new TRPCError({ code: "CONFLICT", message: "This merchant order reference already exists. Use a new unique order ID." });
        }
        const requestRows = await tx.insert(paymentRequests).values({
          publicId, merchantId: merchant.id, workflowId: input.workflowId ?? null,
          idempotencyKey: input.idempotencyKey, idempotencyPayloadHash,
          orderId: input.orderId || null, description: input.description,
          customerReference: input.customerReference || null, amountBaseUnits,
          network: input.network, mint, receivingWallet: wallet, referencePublicKey,
          overpaymentPolicy: input.overpaymentPolicy, redirectUrl,
          status: "AWAITING_PAYMENT", expiresAt,
        }).$returningId();
        const createdId = requestRows[0]?.id;
        if (!createdId) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Payment request could not be saved." });
        if (input.orderId) await tx.insert(orders).values({ merchantId: merchant.id, publicOrderId: input.orderId, description: input.description, expectedAmountBaseUnits: amountBaseUnits, paymentRequestId: createdId, paymentStatus: "AWAITING_PAYMENT" });
        const [event] = await tx.insert(paymentEvents).values({ merchantId: merchant.id, paymentRequestId: createdId, eventType: "request_created", payload: { publicId, amountBaseUnits, network: input.network } }).$returningId();
        await appendAuditEvent(tx, merchant.id, createdId, "request_created", { publicId, amountBaseUnits, network: input.network, expiresAt });
        if (event?.id) await enqueueWorkflowEvent(tx, merchant.id, createdId, event.id, "request_created");
        return { publicId, amountBaseUnits, expiresAt, status: "AWAITING_PAYMENT" as const };
      });
      return { publicId: created.publicId, amountBaseUnits: created.amountBaseUnits, amount: formatUsdcAmount(created.amountBaseUnits), url: `/pay/${created.publicId}`, expiresAt: created.expiresAt, status: created.status };
    }),
    publicGet: publicProcedure.input(z.object({ publicId: z.string().min(16).max(48) })).query(async ({ ctx, input }) => {
      enforceRateLimit(`public-get:${ctx.req.ip ?? "unknown"}`, 90);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Payment database is unavailable." });
      const [request] = await db.select().from(paymentRequests).where(eq(paymentRequests.publicId, input.publicId)).limit(1);
      if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Payment request not found." });
      const [merchant] = await db.select().from(merchants).where(eq(merchants.id, request.merchantId)).limit(1);
      const [receipt] = await db.select().from(receipts).where(eq(receipts.paymentRequestId, request.id)).limit(1);
      const events = await db.select({ eventType: paymentEvents.eventType, createdAt: paymentEvents.createdAt }).from(paymentEvents).where(eq(paymentEvents.paymentRequestId, request.id)).orderBy(desc(paymentEvents.createdAt)).limit(20);
      return {
        publicId: request.publicId, merchantName: merchant?.displayName ?? "Merchant",
        amount: formatUsdcAmount(request.amountBaseUnits), amountBaseUnits: request.amountBaseUnits,
        network: request.network, mint: request.mint, receivingWallet: request.receivingWallet, referencePublicKey: request.referencePublicKey,
        orderId: request.orderId, description: request.description, customerReference: request.customerReference,
        status: request.status, expiresAt: request.expiresAt, receiptNumber: receipt?.receiptNumber ?? null,
        receipt: receipt?.snapshot ?? null, events,
        redirectUrl: ["CONFIRMED", "OVERPAID"].includes(request.status) ? request.redirectUrl : null,
      };
    }),
    submitSignature: publicProcedure.input(SubmitSignatureSchema).mutation(async ({ ctx, input }) => {
      enforceRateLimit(`signature:${ctx.req.ip ?? "unknown"}`, 8);
      return verifyAndSettleSignature(input.publicId, input.signature);
    }),
    reconcile: protectedProcedure.input(z.object({ publicId: z.string().min(16).max(48) })).mutation(async ({ ctx, input }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      try { enforceRateLimit(`reconcile:${merchant.id}`, 12); }
      catch { throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Reconciliation rate limit reached. Try again shortly." }); }
      const [request] = await db.select().from(paymentRequests).where(and(eq(paymentRequests.publicId, input.publicId), eq(paymentRequests.merchantId, merchant.id))).limit(1);
      if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Payment request not found." });
      const pending = await db.select().from(paymentAttempts).where(and(eq(paymentAttempts.paymentRequestId, request.id), eq(paymentAttempts.merchantId, merchant.id), inArray(paymentAttempts.status, ["VERIFYING", "DETECTED"]), isNotNull(paymentAttempts.signature))).orderBy(desc(paymentAttempts.createdAt)).limit(5);
      await db.transaction(tx => appendAuditEvent(tx, merchant.id, request.id, "manual_reconciliation_requested", { pendingAttemptCount: pending.length }));
      let checked = 0;
      for (const attempt of pending) {
        if (!attempt.signature) continue;
        checked += 1;
        try { await verifyAndSettleSignature(request.publicId, attempt.signature); }
        catch { /* Detailed verification/RPC errors remain in the attempt and audit records. */ }
        const [current] = await db.select({ status: paymentRequests.status }).from(paymentRequests).where(eq(paymentRequests.id, request.id)).limit(1);
        if (current && ["CONFIRMED", "OVERPAID"].includes(current.status)) break;
      }
      const [current] = await db.select({ status: paymentRequests.status }).from(paymentRequests).where(eq(paymentRequests.id, request.id)).limit(1);
      const remaining = await db.select({ id: paymentAttempts.id }).from(paymentAttempts).where(and(eq(paymentAttempts.paymentRequestId, request.id), eq(paymentAttempts.merchantId, merchant.id), inArray(paymentAttempts.status, ["VERIFYING", "DETECTED"]), isNotNull(paymentAttempts.signature))).limit(5);
      return { checked, pending: remaining.length, status: current?.status ?? request.status, message: checked ? "Pending signatures were rechecked by the server; any remaining uncertainty is still pending, never treated as paid." : "No pending transaction signatures were available to reconcile." };
    }),
    detail: protectedProcedure.input(z.object({ id: z.number().int().positive() })).query(async ({ ctx, input }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      const [request] = await db.select().from(paymentRequests).where(and(eq(paymentRequests.id, input.id), eq(paymentRequests.merchantId, merchant.id))).limit(1);
      if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Payment request not found." });
      const events = await db.select().from(paymentEvents).where(and(eq(paymentEvents.paymentRequestId, request.id), eq(paymentEvents.merchantId, merchant.id))).orderBy(desc(paymentEvents.createdAt));
      const transfers = await db.select().from(verifiedTransfers).where(and(eq(verifiedTransfers.paymentRequestId, request.id), eq(verifiedTransfers.merchantId, merchant.id)));
      const attempts = await db.select().from(paymentAttempts).where(and(eq(paymentAttempts.paymentRequestId, request.id), eq(paymentAttempts.merchantId, merchant.id))).orderBy(desc(paymentAttempts.createdAt));
      return { request, events, transfers, attempts };
    }),
  }),
  orders: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      return db.select().from(orders).where(eq(orders.merchantId, merchant.id)).orderBy(desc(orders.createdAt)).limit(100);
    }),
  }),
  receipts: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      return db.select().from(receipts).where(eq(receipts.merchantId, merchant.id)).orderBy(desc(receipts.createdAt)).limit(100);
    }),
  }),
  workflows: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      const rows = await db.select().from(workflows).where(eq(workflows.merchantId, merchant.id)).orderBy(desc(workflows.createdAt));
      const actions = await db.select().from(workflowActions).where(eq(workflowActions.merchantId, merchant.id));
      return rows.map(workflow => ({ ...workflow, actions: actions.filter(action => action.workflowId === workflow.id) }));
    }),
    create: protectedProcedure.input(WorkflowDraftSchema).mutation(async ({ ctx, input }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      return db.transaction(async tx => {
        const [created] = await tx.insert(workflows).values({ merchantId: merchant.id, name: input.name, trigger: input.trigger, enabled: input.enabled ? 1 : 0, conditionJson: input.conditions }).$returningId();
        if (!created?.id) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Workflow could not be created." });
        await tx.insert(workflowActions).values(input.actions.map((kind, index) => ({ merchantId: merchant.id, workflowId: created.id, kind, sortOrder: index })));
        await appendAuditEvent(tx, merchant.id, null, "workflow_created", { workflowId: created.id, trigger: input.trigger, conditions: input.conditions, actions: input.actions, enabled: input.enabled });
        return { id: created.id, name: input.name, enabled: input.enabled };
      });
    }),
    setEnabled: protectedProcedure.input(z.object({ id: z.number().int().positive(), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      const [workflow] = await db.select().from(workflows).where(and(eq(workflows.id, input.id), eq(workflows.merchantId, merchant.id))).limit(1);
      if (!workflow) throw new TRPCError({ code: "NOT_FOUND", message: "Workflow not found." });
      await db.transaction(async tx => {
        await tx.update(workflows).set({ enabled: input.enabled ? 1 : 0, updatedAt: new Date() }).where(and(eq(workflows.id, input.id), eq(workflows.merchantId, merchant.id)));
        await appendAuditEvent(tx, merchant.id, null, input.enabled ? "workflow_activated" : "workflow_paused", { workflowId: input.id });
      });
      return { id: input.id, enabled: input.enabled };
    }),
    draft: protectedProcedure.input(z.object({ instruction: z.string().min(5).max(2000) })).mutation(({ input }) => draftWorkflowFromText(input.instruction)),
    simulate: protectedProcedure.input(z.object({ workflowId: z.number().int().positive().optional(), instruction: z.string().max(2000).optional() })).mutation(async ({ ctx, input }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      let draft = input.instruction ? draftWorkflowFromText(input.instruction) : null;
      if (input.workflowId) {
        const [workflow] = await db.select().from(workflows).where(and(eq(workflows.id, input.workflowId), eq(workflows.merchantId, merchant.id))).limit(1);
        if (!workflow) throw new TRPCError({ code: "NOT_FOUND", message: "Workflow not found." });
        const actions = await db.select().from(workflowActions).where(and(eq(workflowActions.workflowId, workflow.id), eq(workflowActions.merchantId, merchant.id)));
        draft = { trigger: workflow.trigger, actions: actions.map(action => action.kind), conditions: ["verified event only", "simulation cannot execute external side effects"], rationale: "Saved workflow preview." };
      }
      if (!draft) throw new TRPCError({ code: "BAD_REQUEST", message: "Select a workflow or enter a workflow instruction." });
      return simulateWorkflow(draft);
    }),
    executions: protectedProcedure.query(async ({ ctx }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      return db.select().from(workflowExecutions).where(eq(workflowExecutions.merchantId, merchant.id)).orderBy(desc(workflowExecutions.createdAt)).limit(100);
    }),
    retry: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      const [execution] = await db.select().from(workflowExecutions).where(and(eq(workflowExecutions.id, input.id), eq(workflowExecutions.merchantId, merchant.id))).limit(1);
      if (!execution || !["FAILED", "DEAD_LETTER"].includes(execution.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "Only failed workflow executions can be retried." });
      await db.update(workflowExecutions).set({ status: "QUEUED", availableAt: new Date(), lastError: null, updatedAt: new Date() }).where(and(eq(workflowExecutions.id, execution.id), eq(workflowExecutions.merchantId, merchant.id)));
      return { status: "QUEUED" as const };
    }),
  }),
  settings: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const { merchant, settings } = await merchantFor(ctx.user.openId, ctx.user.name);
      return { merchant: { displayName: merchant.displayName, logoUrl: merchant.logoUrl }, settings: { network: settings.network, receivingWallet: settings.receivingWallet ?? "", overpaymentPolicy: settings.overpaymentPolicy, email: settings.email ?? "", telegramChatId: settings.telegramChatId ?? "", telegramConfigured: Boolean(settings.telegramBotTokenEncrypted), emailProviderConfigured: Boolean(process.env.RESEND_API_KEY), payboxConfigured: Boolean(process.env.PAYBOX_ACCESS_TOKEN) } };
    }),
    update: protectedProcedure.input(SettingsSchema).mutation(async ({ ctx, input }) => {
      const { db, merchant, settings } = await merchantFor(ctx.user.openId, ctx.user.name);
      const receivingWallet = input.receivingWallet ? validateWallet(input.receivingWallet) : null;
      await db.transaction(async tx => {
        await tx.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, merchant.id)).for("update");
        await tx.update(merchants).set({ displayName: input.displayName, updatedAt: new Date() }).where(eq(merchants.id, merchant.id));
        await tx.update(merchantSettings).set({ network: input.network, receivingWallet, email: input.email || null, telegramChatId: input.telegramChatId || null, overpaymentPolicy: input.overpaymentPolicy, updatedAt: new Date() }).where(eq(merchantSettings.id, settings.id));
        await appendAuditEvent(tx, merchant.id, null, "merchant_settings_updated", { network: input.network, walletConfigured: Boolean(receivingWallet), overpaymentPolicy: input.overpaymentPolicy });
      });
      return { success: true } as const;
    }),
    saveTelegramBotToken: protectedProcedure.input(z.object({ token: z.string().regex(/^\d{5,15}:[A-Za-z0-9_-]{30,60}$/) })).mutation(async ({ ctx, input }) => {
      const { db, merchant, settings } = await merchantFor(ctx.user.openId, ctx.user.name);
      if (!settings.telegramChatId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Save the destination Telegram chat ID first so LEXI can validate bot access." });
      try {
        const apiBase = `https://api.telegram.org/bot${input.token}`;
        const botResponse = await fetch(`${apiBase}/getMe`, { signal: AbortSignal.timeout(8_000) });
        const botResult = await botResponse.json() as { ok?: boolean };
        const chatResponse = await fetch(`${apiBase}/getChat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: settings.telegramChatId }), signal: AbortSignal.timeout(8_000) });
        const chatResult = await chatResponse.json() as { ok?: boolean; result?: { id?: string | number } };
        if (!botResponse.ok || !botResult.ok || !chatResponse.ok || !chatResult.ok || chatResult.result?.id == null) throw new Error("Telegram validation failed.");
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Telegram rejected the bot token or the bot cannot access the saved chat. No test message was sent." });
      }
      let encrypted: string;
      try { encrypted = encryptSecret(input.token); } catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configure LEXI_ENCRYPTION_KEY before storing integration credentials." }); }
      await db.transaction(async tx => {
        await tx.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, merchant.id)).for("update");
        await tx.update(merchantSettings).set({ telegramBotTokenEncrypted: encrypted, updatedAt: new Date() }).where(eq(merchantSettings.id, settings.id));
        await appendAuditEvent(tx, merchant.id, null, "telegram_credentials_updated", { tokenStored: true });
      });
      return { success: true } as const;
    }),
    rotateAgentToken: protectedProcedure.mutation(async ({ ctx }) => {
      const { db, merchant, settings } = await merchantFor(ctx.user.openId, ctx.user.name);
      const token = `lexi_live_${randomBytes(32).toString("base64url")}`;
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await db.transaction(async tx => {
        await tx.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, merchant.id)).for("update");
        await tx.update(merchantSettings).set({ apiTokenHash: tokenHash, updatedAt: new Date() }).where(eq(merchantSettings.id, settings.id));
        await appendAuditEvent(tx, merchant.id, null, "agent_token_rotated", { tokenHash: tokenHash.slice(0, 12) });
      });
      return { token, shownOnce: true as const };
    }),
    webhooks: protectedProcedure.query(async ({ ctx }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      const rows = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.merchantId, merchant.id), eq(webhookEndpoints.enabled, 1))).orderBy(desc(webhookEndpoints.createdAt));
      return rows.map(row => ({ id: row.id, url: row.url, subscriptions: row.subscriptions, enabled: row.enabled === 1, createdAt: row.createdAt }));
    }),
    addWebhook: protectedProcedure.input(z.object({ url: z.string().url().max(2048), subscriptions: z.array(z.enum(["request_created", "payment_detected", "payment_confirmed", "payment_underpaid", "payment_expired", "verification_failed"])).min(1).max(6) })).mutation(async ({ ctx, input }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      try { await assertSafeWebhookUrl(input.url); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Unsafe webhook URL." }); }
      const secret = randomBytes(32).toString("hex");
      let secretEncrypted: string;
      try { secretEncrypted = encryptSecret(secret); } catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configure LEXI_ENCRYPTION_KEY before adding webhook secrets." }); }
      return db.transaction(async tx => {
        await tx.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, merchant.id)).for("update");
        const [created] = await tx.insert(webhookEndpoints).values({ merchantId: merchant.id, url: input.url, secretEncrypted, subscriptions: input.subscriptions }).$returningId();
        await appendAuditEvent(tx, merchant.id, null, "webhook_endpoint_created", { id: created?.id, subscriptions: input.subscriptions });
        return { id: created?.id, secret, shownOnce: true as const };
      });
    }),
    removeWebhook: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      return db.transaction(async tx => {
        await tx.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, merchant.id)).for("update");
        const [endpoint] = await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, input.id), eq(webhookEndpoints.merchantId, merchant.id))).limit(1);
        if (!endpoint) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook endpoint not found." });
        await tx.update(webhookEndpoints).set({ enabled: 0, updatedAt: new Date() }).where(and(eq(webhookEndpoints.id, input.id), eq(webhookEndpoints.merchantId, merchant.id)));
        await appendAuditEvent(tx, merchant.id, null, "webhook_endpoint_disabled", { id: input.id });
        return { success: true } as const;
      });
    }),
  }),
  activity: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      return db.select().from(paymentEvents).where(eq(paymentEvents.merchantId, merchant.id)).orderBy(desc(paymentEvents.createdAt)).limit(100);
    }),
    audit: protectedProcedure.query(async ({ ctx }) => {
      const { db, merchant } = await merchantFor(ctx.user.openId, ctx.user.name);
      return db.select().from(auditEvents).where(eq(auditEvents.merchantId, merchant.id)).orderBy(desc(auditEvents.id)).limit(100);
    }),
  }),
  paybox: router({
    info: protectedProcedure.query(async () => ({ ...payboxIntegrationBoundary(), connection: await inspectPayboxConnection() })),
  }),
});

export type AppRouter = typeof appRouter;
