import { createHash } from "node:crypto";
import type { Request, Response } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { Keypair, PublicKey } from "@solana/web3.js";
import { nanoid } from "nanoid";
import { CreateRequestSchema } from "@shared/lexi";
import { merchants, merchantSettings, orders, paymentEvents, paymentRequests, receipts, workflowActions, workflowExecutions, workflows } from "../drizzle/schema";
import { getDb } from "./db";
import { formatUsdcAmount, parseUsdcAmount } from "./payments/amount";
import { paymentIntentFingerprint } from "./payments/idempotency";
import { OFFICIAL_USDC_MINT } from "./payments/solana";
import { appendAuditEvent } from "./security/audit";
import { enforceRateLimit } from "./security/rateLimit";
import { sanitizePublicRedirect } from "./security/redirect";
import { draftWorkflowFromText, simulateWorkflow } from "./workflows/engine";
import { enqueueWorkflowEvent } from "./workflows/enqueue";

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const tools = [
  { name: "create_payment_request", description: "Create a LEXI PayLink invoice. This creates a request only; no payment is confirmed. Reuse idempotencyKey when retrying the same request.", inputSchema: { type: "object", properties: { idempotencyKey: { type: "string", minLength: 16, maxLength: 128, description: "Stable unique key; reuse only for identical invoice terms." }, amount: { type: "string", description: "USDC amount, max 6 decimals" }, description: { type: "string" }, orderId: { type: "string" }, customerReference: { type: "string" }, network: { type: "string", enum: ["mainnet", "devnet"] }, receivingWallet: { type: "string" }, expiresInHours: { type: "number" }, redirectUrl: { type: "string", format: "uri", description: "Optional public HTTPS destination shown/used only after verified settlement." }, workflowId: { type: "integer", description: "Optional merchant-owned, enabled payment-confirmed workflow." } }, required: ["idempotencyKey", "amount", "description", "network", "receivingWallet"] } },
  { name: "get_payment_status", description: "Read the public invoice status and amount; does not assert that a submitted signature is paid.", inputSchema: { type: "object", properties: { paymentId: { type: "string" } }, required: ["paymentId"] } },
  { name: "get_payment_receipt", description: "Retrieve a receipt snapshot only if LEXI has verified settlement.", inputSchema: { type: "object", properties: { paymentId: { type: "string" } }, required: ["paymentId"] } },
  { name: "list_payment_events", description: "List merchant-scoped events for an invoice.", inputSchema: { type: "object", properties: { paymentId: { type: "string" } }, required: ["paymentId"] } },
  { name: "simulate_payment_workflow", description: "Dry-run a workflow without sending notifications, webhooks, transactions, or order updates.", inputSchema: { type: "object", properties: { instruction: { type: "string" } }, required: ["instruction"] } },
  { name: "get_workflow_status", description: "Read recent merchant workflow executions.", inputSchema: { type: "object", properties: { paymentId: { type: "string" } } } },
];

function reply(res: Response, id: RpcMessage["id"], result: unknown) {
  res.status(200).json({ jsonrpc: "2.0", id: id ?? null, result });
}
function fail(res: Response, id: RpcMessage["id"], code: number, message: string) {
  res.status(200).json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}
function externalPaymentUrl(publicId: string) {
  const base = process.env.LEXI_PUBLIC_URL;
  if (!base) return `/pay/${publicId}`;
  const url = new URL(base);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("LEXI_PUBLIC_URL must be a public HTTPS origin.");
  return `${url.origin}/pay/${publicId}`;
}

export async function handleMcpRequest(req: Request, res: Response) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST required" }); return; }
  const authorization = req.header("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (token.length < 32 || token.length > 256) { res.set("WWW-Authenticate", 'Bearer realm="LEXI PayLink"').status(401).json({ error: "A merchant API token is required." }); return; }
  const tokenHash = createHash("sha256").update(token).digest("hex");
  let db;
  try { db = await getDb(); } catch { res.status(503).json({ error: "Payment database is unavailable." }); return; }
  if (!db) { res.status(503).json({ error: "Payment database is unavailable." }); return; }
  const [settings] = await db.select().from(merchantSettings).where(eq(merchantSettings.apiTokenHash, tokenHash)).limit(1);
  if (!settings) { res.set("WWW-Authenticate", 'Bearer realm="LEXI PayLink"').status(401).json({ error: "Invalid merchant API token." }); return; }
  const [merchant] = await db.select().from(merchants).where(eq(merchants.id, settings.merchantId)).limit(1);
  if (!merchant) { res.status(401).json({ error: "Merchant credential is no longer valid." }); return; }
  try {
    enforceRateLimit(`mcp-ip:${req.ip ?? "unknown"}`, 120);
    enforceRateLimit(`mcp-merchant:${merchant.id}`, 120);
  } catch {
    res.status(429).json({ error: "LEXI agent request rate limit reached. Retry later." });
    return;
  }

  const message = req.body as RpcMessage;
  if (message?.jsonrpc !== "2.0" || typeof message.method !== "string") { res.status(400).json({ error: "Invalid JSON-RPC request." }); return; }
  const id = message.id;
  try {
    if (message.method === "initialize") {
      reply(res, id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "lexi-paylink", version: "1.0.0" } });
      return;
    }
    if (message.method === "notifications/initialized") { res.status(202).end(); return; }
    if (message.method === "ping") { reply(res, id, {}); return; }
    if (message.method === "tools/list") { reply(res, id, { tools }); return; }
    if (message.method !== "tools/call") { fail(res, id, -32601, "Method not found."); return; }
    const params = message.params ?? {};
    const name = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    let output: unknown;

    if (name === "create_payment_request") {
      const parsed = CreateRequestSchema.safeParse({ ...args, expiresInHours: Number(args.expiresInHours ?? 24), overpaymentPolicy: "reject" });
      if (!parsed.success) throw new Error("Invalid payment request fields.");
      const redirectUrl = sanitizePublicRedirect(parsed.data.redirectUrl);
      let receivingWallet: string;
      try { receivingWallet = new PublicKey(parsed.data.receivingWallet).toBase58(); } catch { throw new Error("Invalid Solana receiving wallet."); }
      const amountBaseUnits = parseUsdcAmount(parsed.data.amount);
      const publicId = nanoid(32);
      const referencePublicKey = Keypair.generate().publicKey.toBase58();
      const expiresAt = new Date(Date.now() + parsed.data.expiresInHours * 3_600_000);
      const idempotencyPayloadHash = paymentIntentFingerprint({ amountBaseUnits, description: parsed.data.description, orderId: parsed.data.orderId || null, customerReference: parsed.data.customerReference || null, network: parsed.data.network, receivingWallet, expiresInHours: parsed.data.expiresInHours, overpaymentPolicy: parsed.data.overpaymentPolicy, redirectUrl, workflowId: parsed.data.workflowId ?? null });
      const request = await db.transaction(async tx => {
        await tx.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, merchant.id)).for("update");
        const [retry] = await tx.select().from(paymentRequests).where(and(eq(paymentRequests.merchantId, merchant.id), eq(paymentRequests.idempotencyKey, parsed.data.idempotencyKey))).limit(1);
        if (retry) {
          if (retry.idempotencyPayloadHash !== idempotencyPayloadHash) throw new Error("This idempotency key was already used with different invoice terms. Use a new key for a new request.");
          return retry;
        }
        if (parsed.data.workflowId) {
          const [workflow] = await tx.select().from(workflows).where(and(eq(workflows.id, parsed.data.workflowId), eq(workflows.merchantId, merchant.id))).limit(1);
          if (!workflow || workflow.trigger !== "payment_confirmed" || workflow.enabled !== 1) throw new Error("Select an enabled payment-confirmed workflow owned by this merchant.");
          const selectedActions = await tx.select().from(workflowActions).where(and(eq(workflowActions.workflowId, workflow.id), eq(workflowActions.merchantId, merchant.id)));
          if (selectedActions.some(action => action.kind === "redirect") && !redirectUrl) throw new Error("This workflow includes a redirect action; configure its HTTPS success URL on the payment request.");
        }
        if (parsed.data.orderId) {
          const [existing] = await tx.select().from(orders).where(and(eq(orders.merchantId, merchant.id), eq(orders.publicOrderId, parsed.data.orderId))).limit(1);
          if (existing) throw new Error("This merchant order reference already exists. Use a new unique order ID.");
        }
        const [inserted] = await tx.insert(paymentRequests).values({
          publicId, merchantId: merchant.id, workflowId: parsed.data.workflowId ?? null, idempotencyKey: parsed.data.idempotencyKey, idempotencyPayloadHash, orderId: parsed.data.orderId || null,
          description: parsed.data.description, customerReference: parsed.data.customerReference || null,
          amountBaseUnits, network: parsed.data.network, mint: OFFICIAL_USDC_MINT[parsed.data.network],
          receivingWallet, referencePublicKey, overpaymentPolicy: parsed.data.overpaymentPolicy, redirectUrl,
          status: "AWAITING_PAYMENT", expiresAt,
        }).$returningId();
        if (!inserted?.id) throw new Error("Payment request could not be saved.");
        if (parsed.data.orderId) await tx.insert(orders).values({ merchantId: merchant.id, publicOrderId: parsed.data.orderId, description: parsed.data.description, expectedAmountBaseUnits: amountBaseUnits, paymentRequestId: inserted.id, paymentStatus: "AWAITING_PAYMENT" });
        const [event] = await tx.insert(paymentEvents).values({ merchantId: merchant.id, paymentRequestId: inserted.id, eventType: "request_created", payload: { publicId, amountBaseUnits, network: parsed.data.network, source: "mcp" } }).$returningId();
        await appendAuditEvent(tx, merchant.id, inserted.id, "request_created", { publicId, amountBaseUnits, network: parsed.data.network, source: "mcp" });
        if (event?.id) await enqueueWorkflowEvent(tx, merchant.id, inserted.id, event.id, "request_created");
        return { id: inserted.id, publicId, amountBaseUnits, expiresAt, status: "AWAITING_PAYMENT" as const };
      });
      output = { paymentId: request.publicId, paymentUrl: externalPaymentUrl(request.publicId), requestRecordId: request.id, amountBaseUnits: request.amountBaseUnits, amount: formatUsdcAmount(request.amountBaseUnits), currency: "USDC", network: parsed.data.network, status: request.status, expiresAt: request.expiresAt.toISOString(), note: "Request created only. Payment is not confirmed until LEXI verifies a finalized Solana transfer containing this invoice's unique reference." };
    } else if (name === "get_payment_status" || name === "get_payment_receipt" || name === "list_payment_events") {
      const paymentId = String(args.paymentId ?? "");
      const [request] = await db.select().from(paymentRequests).where(and(eq(paymentRequests.publicId, paymentId), eq(paymentRequests.merchantId, merchant.id))).limit(1);
      if (!request) throw new Error("Payment request not found for this merchant.");
      if (name === "get_payment_status") output = { paymentId, amountBaseUnits: request.amountBaseUnits, network: request.network, status: request.status, expiresAt: request.expiresAt.toISOString() };
      if (name === "get_payment_receipt") {
        const [receipt] = await db.select().from(receipts).where(and(eq(receipts.paymentRequestId, request.id), eq(receipts.merchantId, merchant.id))).limit(1);
        output = receipt ? receipt.snapshot : { receiptAvailable: false, status: request.status, note: "LEXI exposes a paid receipt only after verified settlement." };
      }
      if (name === "list_payment_events") output = await db.select().from(paymentEvents).where(and(eq(paymentEvents.paymentRequestId, request.id), eq(paymentEvents.merchantId, merchant.id))).orderBy(asc(paymentEvents.createdAt)).limit(100);
    } else if (name === "simulate_payment_workflow") {
      const instruction = String(args.instruction ?? "");
      if (instruction.length < 5 || instruction.length > 2000) throw new Error("Instruction must be 5–2000 characters.");
      output = simulateWorkflow(draftWorkflowFromText(instruction));
    } else if (name === "get_workflow_status") {
      const paymentId = typeof args.paymentId === "string" ? args.paymentId : null;
      if (paymentId) {
        const [request] = await db.select().from(paymentRequests).where(and(eq(paymentRequests.publicId, paymentId), eq(paymentRequests.merchantId, merchant.id))).limit(1);
        if (!request) throw new Error("Payment request not found for this merchant.");
        output = await db.select().from(workflowExecutions).where(and(eq(workflowExecutions.paymentRequestId, request.id), eq(workflowExecutions.merchantId, merchant.id))).orderBy(desc(workflowExecutions.createdAt)).limit(30);
      } else output = await db.select().from(workflowExecutions).where(eq(workflowExecutions.merchantId, merchant.id)).orderBy(desc(workflowExecutions.createdAt)).limit(30);
    } else { fail(res, id, -32602, "Unknown tool name."); return; }

    reply(res, id, { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output, isError: false });
  } catch (error) {
    reply(res, id, { content: [{ type: "text", text: error instanceof Error ? error.message : "Tool call failed." }], isError: true });
  }
}
