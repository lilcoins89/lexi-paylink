import { decimal, index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const merchants = mysqlTable("merchants", {
  id: int("id").autoincrement().primaryKey(),
  ownerOpenId: varchar("ownerOpenId", { length: 64 }).notNull(),
  displayName: varchar("displayName", { length: 120 }).notNull(),
  logoUrl: varchar("logoUrl", { length: 2048 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ owner: uniqueIndex("merchants_owner_open_id_uq").on(table.ownerOpenId) }));

export const merchantSettings = mysqlTable("merchant_settings", {
  id: int("id").autoincrement().primaryKey(),
  merchantId: int("merchantId").notNull(),
  network: mysqlEnum("network", ["mainnet", "devnet"]).default("mainnet").notNull(),
  receivingWallet: varchar("receivingWallet", { length: 64 }),
  overpaymentPolicy: mysqlEnum("overpaymentPolicy", ["reject", "accept"]).default("reject").notNull(),
  telegramChatId: varchar("telegramChatId", { length: 128 }),
  telegramBotTokenEncrypted: text("telegramBotTokenEncrypted"),
  email: varchar("email", { length: 320 }),
  emailProvider: varchar("emailProvider", { length: 32 }),
  apiTokenHash: varchar("apiTokenHash", { length: 64 }),
  payboxAccessTokenEncrypted: text("payboxAccessTokenEncrypted"),
  payboxRefreshTokenEncrypted: text("payboxRefreshTokenEncrypted"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ merchant: uniqueIndex("merchant_settings_merchant_uq").on(table.merchantId) }));

export const workflows = mysqlTable("workflows", {
  id: int("id").autoincrement().primaryKey(),
  merchantId: int("merchantId").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  trigger: mysqlEnum("trigger", ["request_created", "payment_detected", "payment_confirmed", "payment_underpaid", "payment_expired", "verification_failed"]).notNull(),
  conditionJson: json("conditionJson").$type<Record<string, unknown>>(),
  enabled: int("enabled").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ merchant: index("workflows_merchant_idx").on(table.merchantId) }));

export const paymentRequests = mysqlTable("payment_requests", {
  id: int("id").autoincrement().primaryKey(),
  publicId: varchar("publicId", { length: 48 }).notNull(),
  merchantId: int("merchantId").notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }),
  idempotencyPayloadHash: varchar("idempotencyPayloadHash", { length: 64 }),
  workflowId: int("workflowId"),
  orderId: varchar("orderId", { length: 120 }),
  description: varchar("description", { length: 500 }).notNull(),
  customerReference: varchar("customerReference", { length: 255 }),
  amountBaseUnits: decimal("amountBaseUnits", { precision: 30, scale: 0 }).notNull(),
  network: mysqlEnum("network", ["mainnet", "devnet"]).notNull(),
  mint: varchar("mint", { length: 64 }).notNull(),
  receivingWallet: varchar("receivingWallet", { length: 64 }).notNull(),
  referencePublicKey: varchar("referencePublicKey", { length: 64 }).notNull(),
  overpaymentPolicy: mysqlEnum("overpaymentPolicy", ["reject", "accept"]).notNull(),
  redirectUrl: varchar("redirectUrl", { length: 2048 }),
  status: mysqlEnum("status", ["CREATED", "AWAITING_PAYMENT", "DETECTED", "VERIFYING", "CONFIRMED", "UNDERPAID", "OVERPAID", "EXPIRED", "FAILED", "REJECTED"]).default("CREATED").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  publicId: uniqueIndex("payment_requests_public_id_uq").on(table.publicId),
  idempotency: uniqueIndex("payment_requests_idempotency_uq").on(table.merchantId, table.idempotencyKey),
  merchant: index("payment_requests_merchant_idx").on(table.merchantId, table.createdAt),
  status: index("payment_requests_status_idx").on(table.status, table.expiresAt),
}));

export const paymentAttempts = mysqlTable("payment_attempts", {
  id: int("id").autoincrement().primaryKey(),
  merchantId: int("merchantId").notNull(),
  paymentRequestId: int("paymentRequestId").notNull(),
  signature: varchar("signature", { length: 100 }),
  status: varchar("status", { length: 32 }).notNull(),
  detectedAt: timestamp("detectedAt"),
  lastCheckedAt: timestamp("lastCheckedAt"),
  failureReason: text("failureReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  request: index("payment_attempts_request_idx").on(table.paymentRequestId),
  requestSignature: uniqueIndex("payment_attempts_request_signature_uq").on(table.paymentRequestId, table.signature),
  reconciliation: index("payment_attempts_reconciliation_idx").on(table.status, table.lastCheckedAt),
}));

export const verifiedTransfers = mysqlTable("verified_transfers", {
  id: int("id").autoincrement().primaryKey(),
  merchantId: int("merchantId").notNull(),
  paymentRequestId: int("paymentRequestId").notNull(),
  transactionSignature: varchar("transactionSignature", { length: 100 }).notNull(),
  amountBaseUnits: decimal("amountBaseUnits", { precision: 30, scale: 0 }).notNull(),
  mint: varchar("mint", { length: 64 }).notNull(),
  receivingWallet: varchar("receivingWallet", { length: 64 }).notNull(),
  network: mysqlEnum("network", ["mainnet", "devnet"]).notNull(),
  acceptedForFulfillment: int("acceptedForFulfillment").default(0).notNull(),
  confirmedAt: timestamp("confirmedAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  signature: uniqueIndex("verified_transfers_signature_uq").on(table.transactionSignature),
  request: index("verified_transfers_request_idx").on(table.paymentRequestId),
}));

export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  merchantId: int("merchantId").notNull(),
  publicOrderId: varchar("publicOrderId", { length: 120 }).notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  expectedAmountBaseUnits: decimal("expectedAmountBaseUnits", { precision: 30, scale: 0 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("USDC").notNull(),
  paymentRequestId: int("paymentRequestId"),
  paymentStatus: varchar("paymentStatus", { length: 32 }).default("AWAITING_PAYMENT").notNull(),
  confirmedSignature: varchar("confirmedSignature", { length: 100 }),
  workflowStatus: varchar("workflowStatus", { length: 32 }).default("NOT_STARTED").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  merchant: index("orders_merchant_idx").on(table.merchantId, table.createdAt),
  publicOrder: uniqueIndex("orders_merchant_order_uq").on(table.merchantId, table.publicOrderId),
}));

export const receipts = mysqlTable("receipts", {
  id: int("id").autoincrement().primaryKey(),
  merchantId: int("merchantId").notNull(),
  paymentRequestId: int("paymentRequestId").notNull(),
  receiptNumber: varchar("receiptNumber", { length: 64 }).notNull(),
  snapshot: json("snapshot").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  receiptNumber: uniqueIndex("receipts_number_uq").on(table.receiptNumber),
  request: uniqueIndex("receipts_request_uq").on(table.paymentRequestId),
}));

export const workflowActions = mysqlTable("workflow_actions", {
  id: int("id").autoincrement().primaryKey(),
  merchantId: int("merchantId").notNull(),
  workflowId: int("workflowId").notNull(),
  kind: mysqlEnum("kind", ["create_receipt", "mark_order_paid", "telegram", "email", "webhook", "redirect", "record_event"]).notNull(),
  config: json("config").$type<Record<string, unknown>>(),
  sortOrder: int("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ workflow: index("workflow_actions_workflow_idx").on(table.workflowId, table.sortOrder) }));

export const workflowExecutions = mysqlTable("workflow_executions", {
  id: int("id").autoincrement().primaryKey(),
  merchantId: int("merchantId").notNull(),
  paymentRequestId: int("paymentRequestId").notNull(),
  workflowId: int("workflowId"),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
  eventType: varchar("eventType", { length: 48 }).notNull(),
  status: mysqlEnum("status", ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "DEAD_LETTER", "SIMULATED"]).default("QUEUED").notNull(),
  attempts: int("attempts").default(0).notNull(),
  availableAt: timestamp("availableAt").defaultNow().notNull(),
  leaseUntil: timestamp("leaseUntil"),
  actions: json("actions").$type<Array<Record<string, unknown>>>().notNull(),
  lastError: text("lastError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  idempotency: uniqueIndex("workflow_executions_idempotency_uq").on(table.idempotencyKey),
  ready: index("workflow_executions_ready_idx").on(table.status, table.availableAt),
  merchant: index("workflow_executions_merchant_idx").on(table.merchantId, table.createdAt),
}));

export const paymentEvents = mysqlTable("payment_events", {
  id: int("id").autoincrement().primaryKey(),
  merchantId: int("merchantId").notNull(),
  paymentRequestId: int("paymentRequestId").notNull(),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }),
  payload: json("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ request: index("payment_events_request_idx").on(table.paymentRequestId, table.createdAt), idempotency: uniqueIndex("payment_events_idempotency_uq").on(table.idempotencyKey) }));

export const notificationAttempts = mysqlTable("notification_attempts", {
  id: int("id").autoincrement().primaryKey(),
  merchantId: int("merchantId").notNull(),
  workflowExecutionId: int("workflowExecutionId").notNull(),
  channel: mysqlEnum("channel", ["telegram", "email"]).notNull(),
  status: mysqlEnum("status", ["QUEUED", "SENT", "FAILED"]).default("QUEUED").notNull(),
  attempts: int("attempts").default(0).notNull(),
  responseCode: int("responseCode"),
  error: text("error"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ execution: index("notification_attempts_execution_idx").on(table.workflowExecutionId) }));

export const webhookEndpoints = mysqlTable("webhook_endpoints", {
  id: int("id").autoincrement().primaryKey(),
  merchantId: int("merchantId").notNull(),
  url: varchar("url", { length: 2048 }).notNull(),
  secretEncrypted: text("secretEncrypted").notNull(),
  subscriptions: json("subscriptions").$type<string[]>().notNull(),
  enabled: int("enabled").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({ merchant: index("webhook_endpoints_merchant_idx").on(table.merchantId) }));

export const webhookDeliveries = mysqlTable("webhook_deliveries", {
  id: int("id").autoincrement().primaryKey(),
  merchantId: int("merchantId").notNull(),
  endpointId: int("endpointId").notNull(),
  eventId: int("eventId").notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
  status: mysqlEnum("status", ["QUEUED", "DELIVERED", "FAILED", "DEAD_LETTER"]).default("QUEUED").notNull(),
  attempts: int("attempts").default(0).notNull(),
  responseCode: int("responseCode"),
  lastError: text("lastError"),
  nextAttemptAt: timestamp("nextAttemptAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  idempotency: uniqueIndex("webhook_deliveries_idempotency_uq").on(table.idempotencyKey),
  queue: index("webhook_deliveries_queue_idx").on(table.status, table.nextAttemptAt),
}));

export const auditEvents = mysqlTable("audit_events", {
  id: int("id").autoincrement().primaryKey(),
  merchantId: int("merchantId").notNull(),
  paymentRequestId: int("paymentRequestId"),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  canonicalPayload: text("canonicalPayload").notNull(),
  previousHash: varchar("previousHash", { length: 64 }),
  eventHash: varchar("eventHash", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  sequence: index("audit_events_sequence_idx").on(table.merchantId, table.id),
  hash: uniqueIndex("audit_events_hash_uq").on(table.eventHash),
}));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Merchant = typeof merchants.$inferSelect;
export type PaymentRequest = typeof paymentRequests.$inferSelect;
export type Workflow = typeof workflows.$inferSelect;
