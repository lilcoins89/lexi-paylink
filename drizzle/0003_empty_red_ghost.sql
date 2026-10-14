ALTER TABLE `payment_requests` ADD `idempotencyKey` varchar(128);--> statement-breakpoint
ALTER TABLE `payment_requests` ADD `idempotencyPayloadHash` varchar(64);--> statement-breakpoint
ALTER TABLE `payment_requests` ADD CONSTRAINT `payment_requests_idempotency_uq` UNIQUE(`merchantId`,`idempotencyKey`);