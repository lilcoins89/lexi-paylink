CREATE TABLE `audit_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`merchantId` int NOT NULL,
	`paymentRequestId` int,
	`eventType` varchar(64) NOT NULL,
	`canonicalPayload` text NOT NULL,
	`previousHash` varchar(64),
	`eventHash` varchar(64) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `audit_events_hash_uq` UNIQUE(`eventHash`)
);
--> statement-breakpoint
CREATE TABLE `merchant_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`merchantId` int NOT NULL,
	`network` enum('mainnet','devnet') NOT NULL DEFAULT 'mainnet',
	`receivingWallet` varchar(64),
	`overpaymentPolicy` enum('reject','accept') NOT NULL DEFAULT 'reject',
	`telegramChatId` varchar(128),
	`telegramBotTokenEncrypted` text,
	`email` varchar(320),
	`emailProvider` varchar(32),
	`apiTokenHash` varchar(64),
	`payboxAccessTokenEncrypted` text,
	`payboxRefreshTokenEncrypted` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `merchant_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `merchant_settings_merchant_uq` UNIQUE(`merchantId`)
);
--> statement-breakpoint
CREATE TABLE `merchants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ownerOpenId` varchar(64) NOT NULL,
	`displayName` varchar(120) NOT NULL,
	`logoUrl` varchar(2048),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `merchants_id` PRIMARY KEY(`id`),
	CONSTRAINT `merchants_owner_open_id_uq` UNIQUE(`ownerOpenId`)
);
--> statement-breakpoint
CREATE TABLE `notification_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`merchantId` int NOT NULL,
	`workflowExecutionId` int NOT NULL,
	`channel` enum('telegram','email') NOT NULL,
	`status` enum('QUEUED','SENT','FAILED') NOT NULL DEFAULT 'QUEUED',
	`attempts` int NOT NULL DEFAULT 0,
	`responseCode` int,
	`error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notification_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`merchantId` int NOT NULL,
	`publicOrderId` varchar(120) NOT NULL,
	`description` varchar(500) NOT NULL,
	`expectedAmountBaseUnits` decimal(30,0) NOT NULL,
	`currency` varchar(8) NOT NULL DEFAULT 'USDC',
	`paymentRequestId` int,
	`paymentStatus` varchar(32) NOT NULL DEFAULT 'AWAITING_PAYMENT',
	`confirmedSignature` varchar(100),
	`workflowStatus` varchar(32) NOT NULL DEFAULT 'NOT_STARTED',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_merchant_order_uq` UNIQUE(`merchantId`,`publicOrderId`)
);
--> statement-breakpoint
CREATE TABLE `payment_attempts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`merchantId` int NOT NULL,
	`paymentRequestId` int NOT NULL,
	`signature` varchar(100),
	`status` varchar(32) NOT NULL,
	`failureReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_attempts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payment_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`merchantId` int NOT NULL,
	`paymentRequestId` int NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`payload` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payment_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`publicId` varchar(48) NOT NULL,
	`merchantId` int NOT NULL,
	`workflowId` int,
	`orderId` varchar(120),
	`description` varchar(500) NOT NULL,
	`customerReference` varchar(255),
	`amountBaseUnits` decimal(30,0) NOT NULL,
	`network` enum('mainnet','devnet') NOT NULL,
	`mint` varchar(64) NOT NULL,
	`receivingWallet` varchar(64) NOT NULL,
	`overpaymentPolicy` enum('reject','accept') NOT NULL,
	`redirectUrl` varchar(2048),
	`status` enum('CREATED','AWAITING_PAYMENT','DETECTED','VERIFYING','CONFIRMED','UNDERPAID','OVERPAID','EXPIRED','FAILED','REJECTED') NOT NULL DEFAULT 'CREATED',
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payment_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `payment_requests_public_id_uq` UNIQUE(`publicId`)
);
--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`merchantId` int NOT NULL,
	`paymentRequestId` int NOT NULL,
	`receiptNumber` varchar(64) NOT NULL,
	`snapshot` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `receipts_id` PRIMARY KEY(`id`),
	CONSTRAINT `receipts_number_uq` UNIQUE(`receiptNumber`),
	CONSTRAINT `receipts_request_uq` UNIQUE(`paymentRequestId`)
);
--> statement-breakpoint
CREATE TABLE `verified_transfers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`merchantId` int NOT NULL,
	`paymentRequestId` int NOT NULL,
	`transactionSignature` varchar(100) NOT NULL,
	`amountBaseUnits` decimal(30,0) NOT NULL,
	`mint` varchar(64) NOT NULL,
	`receivingWallet` varchar(64) NOT NULL,
	`network` enum('mainnet','devnet') NOT NULL,
	`acceptedForFulfillment` int NOT NULL DEFAULT 0,
	`confirmedAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `verified_transfers_id` PRIMARY KEY(`id`),
	CONSTRAINT `verified_transfers_signature_uq` UNIQUE(`transactionSignature`)
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`merchantId` int NOT NULL,
	`endpointId` int NOT NULL,
	`eventId` int NOT NULL,
	`idempotencyKey` varchar(128) NOT NULL,
	`status` enum('QUEUED','DELIVERED','FAILED','DEAD_LETTER') NOT NULL DEFAULT 'QUEUED',
	`attempts` int NOT NULL DEFAULT 0,
	`responseCode` int,
	`lastError` text,
	`nextAttemptAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `webhook_deliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `webhook_deliveries_idempotency_uq` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `webhook_endpoints` (
	`id` int AUTO_INCREMENT NOT NULL,
	`merchantId` int NOT NULL,
	`url` varchar(2048) NOT NULL,
	`secretEncrypted` text NOT NULL,
	`subscriptions` json NOT NULL,
	`enabled` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `webhook_endpoints_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workflow_actions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`merchantId` int NOT NULL,
	`workflowId` int NOT NULL,
	`kind` enum('create_receipt','mark_order_paid','telegram','email','webhook','redirect','record_event') NOT NULL,
	`config` json,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `workflow_actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workflow_executions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`merchantId` int NOT NULL,
	`paymentRequestId` int NOT NULL,
	`workflowId` int,
	`idempotencyKey` varchar(128) NOT NULL,
	`eventType` varchar(48) NOT NULL,
	`status` enum('QUEUED','RUNNING','SUCCEEDED','FAILED','DEAD_LETTER','SIMULATED') NOT NULL DEFAULT 'QUEUED',
	`attempts` int NOT NULL DEFAULT 0,
	`availableAt` timestamp NOT NULL DEFAULT (now()),
	`leaseUntil` timestamp,
	`actions` json NOT NULL,
	`lastError` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workflow_executions_id` PRIMARY KEY(`id`),
	CONSTRAINT `workflow_executions_idempotency_uq` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` int AUTO_INCREMENT NOT NULL,
	`merchantId` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`trigger` enum('request_created','payment_detected','payment_confirmed','payment_underpaid','payment_expired','verification_failed') NOT NULL,
	`conditionJson` json,
	`enabled` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workflows_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `audit_events_sequence_idx` ON `audit_events` (`merchantId`,`id`);--> statement-breakpoint
CREATE INDEX `notification_attempts_execution_idx` ON `notification_attempts` (`workflowExecutionId`);--> statement-breakpoint
CREATE INDEX `orders_merchant_idx` ON `orders` (`merchantId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `payment_attempts_request_idx` ON `payment_attempts` (`paymentRequestId`);--> statement-breakpoint
CREATE INDEX `payment_events_request_idx` ON `payment_events` (`paymentRequestId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `payment_requests_merchant_idx` ON `payment_requests` (`merchantId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `payment_requests_status_idx` ON `payment_requests` (`status`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `verified_transfers_request_idx` ON `verified_transfers` (`paymentRequestId`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_queue_idx` ON `webhook_deliveries` (`status`,`nextAttemptAt`);--> statement-breakpoint
CREATE INDEX `webhook_endpoints_merchant_idx` ON `webhook_endpoints` (`merchantId`);--> statement-breakpoint
CREATE INDEX `workflow_actions_workflow_idx` ON `workflow_actions` (`workflowId`,`sortOrder`);--> statement-breakpoint
CREATE INDEX `workflow_executions_ready_idx` ON `workflow_executions` (`status`,`availableAt`);--> statement-breakpoint
CREATE INDEX `workflow_executions_merchant_idx` ON `workflow_executions` (`merchantId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `workflows_merchant_idx` ON `workflows` (`merchantId`);