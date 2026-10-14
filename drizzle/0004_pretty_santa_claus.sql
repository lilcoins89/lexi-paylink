ALTER TABLE `payment_events` ADD `idempotencyKey` varchar(128);--> statement-breakpoint
ALTER TABLE `payment_events` ADD CONSTRAINT `payment_events_idempotency_uq` UNIQUE(`idempotencyKey`);