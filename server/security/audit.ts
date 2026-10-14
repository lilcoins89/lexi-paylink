import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { auditEvents, merchants } from "../../drizzle/schema";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]));
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function canonicalizeAuditPayload(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function hashAuditEvent(previousHash: string | null, eventType: string, canonicalPayload: string, timestamp: string): string {
  return createHash("sha256").update([previousHash ?? "GENESIS", eventType, canonicalPayload, timestamp].join("\n")).digest("hex");
}

export async function appendAuditEvent(executor: any, merchantId: number, paymentRequestId: number | null, eventType: string, payload: unknown): Promise<void> {
  // Lock the merchant row so two concurrent appends cannot fork the same chain head.
  await executor.select({ id: merchants.id }).from(merchants).where(eq(merchants.id, merchantId)).for("update");
  const [previous] = await executor.select().from(auditEvents).where(eq(auditEvents.merchantId, merchantId)).orderBy(desc(auditEvents.id)).limit(1);
  const timestamp = new Date().toISOString();
  const canonicalPayload = canonicalizeAuditPayload(payload);
  const eventHash = hashAuditEvent(previous?.eventHash ?? null, eventType, canonicalPayload, timestamp);
  await executor.insert(auditEvents).values({ merchantId, paymentRequestId, eventType, canonicalPayload, previousHash: previous?.eventHash ?? null, eventHash });
}
