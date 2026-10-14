import { z } from "zod";

export const NetworkSchema = z.enum(["mainnet", "devnet"]);
export type SolanaNetwork = z.infer<typeof NetworkSchema>;
export const PaymentStatusSchema = z.enum(["CREATED", "AWAITING_PAYMENT", "DETECTED", "VERIFYING", "CONFIRMED", "UNDERPAID", "OVERPAID", "EXPIRED", "FAILED", "REJECTED"]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;
export const WorkflowTriggerSchema = z.enum(["request_created", "payment_detected", "payment_confirmed", "payment_underpaid", "payment_expired", "verification_failed"]);
export type WorkflowTrigger = z.infer<typeof WorkflowTriggerSchema>;
export const WorkflowActionSchema = z.enum(["create_receipt", "mark_order_paid", "telegram", "email", "webhook", "redirect", "record_event"]);
export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;

export const CreateRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(16).max(128),
  amount: z.string().trim().min(1).max(30),
  description: z.string().trim().min(1).max(500),
  orderId: z.string().trim().max(120).optional().default(""),
  customerReference: z.string().trim().max(255).optional(),
  network: NetworkSchema,
  receivingWallet: z.string().trim().min(32).max(64),
  expiresInHours: z.number().int().min(1).max(720).default(24),
  overpaymentPolicy: z.enum(["reject", "accept"]).default("reject"),
  redirectUrl: z.string().url().max(2048).optional().or(z.literal("")),
  workflowId: z.number().int().positive().optional(),
});
export type CreateRequestInput = z.infer<typeof CreateRequestSchema>;

export const SubmitSignatureSchema = z.object({ publicId: z.string().min(16).max(48), signature: z.string().min(80).max(100) });
export const SettingsSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  receivingWallet: z.string().trim().min(32).max(64).or(z.literal("")),
  network: NetworkSchema,
  email: z.string().email().max(320).or(z.literal("")),
  telegramChatId: z.string().trim().max(128),
  overpaymentPolicy: z.enum(["reject", "accept"]),
});
export const WorkflowDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  trigger: WorkflowTriggerSchema,
  actions: z.array(WorkflowActionSchema).min(1).max(7),
  conditions: z.object({ verifiedOnly: z.boolean().default(true), requireOrderId: z.boolean().default(false) }).default({ verifiedOnly: true, requireOrderId: false }),
  enabled: z.boolean().default(false),
});
