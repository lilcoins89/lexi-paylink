ALTER TABLE `payment_attempts` ADD `detectedAt` timestamp;--> statement-breakpoint
ALTER TABLE `payment_attempts` ADD `lastCheckedAt` timestamp;--> statement-breakpoint
ALTER TABLE `payment_requests` ADD `referencePublicKey` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `payment_attempts` ADD CONSTRAINT `payment_attempts_request_signature_uq` UNIQUE(`paymentRequestId`,`signature`);--> statement-breakpoint
CREATE INDEX `payment_attempts_reconciliation_idx` ON `payment_attempts` (`status`,`lastCheckedAt`);