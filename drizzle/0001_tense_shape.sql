CREATE TABLE `accountAuditEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`actorUserId` int,
	`targetUserId` int,
	`eventType` varchar(96) NOT NULL,
	`metadata` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `accountAuditEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sellerApplications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`legalName` varchar(160) NOT NULL,
	`email` varchar(320) NOT NULL,
	`businessName` varchar(160) NOT NULL,
	`craftSummary` text NOT NULL,
	`phone` varchar(40) NOT NULL,
	`city` varchar(100) NOT NULL,
	`status` enum('pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending',
	`reviewNote` text,
	`reviewedByUserId` int,
	`reviewedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sellerApplications_id` PRIMARY KEY(`id`),
	CONSTRAINT `sellerApplications_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
-- Preserve legacy `user` values while the role model transitions to `customer`.
ALTER TABLE `users` MODIFY COLUMN `role` enum('user','customer','seller','staff','admin') NOT NULL DEFAULT 'customer';--> statement-breakpoint
UPDATE `users` SET `role` = 'customer' WHERE `role` = 'user';--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('customer','seller','staff','admin') NOT NULL DEFAULT 'customer';--> statement-breakpoint
ALTER TABLE `accountAuditEvents` ADD CONSTRAINT `accountAuditEvents_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `accountAuditEvents` ADD CONSTRAINT `accountAuditEvents_targetUserId_users_id_fk` FOREIGN KEY (`targetUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sellerApplications` ADD CONSTRAINT `sellerApplications_userId_users_id_fk` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sellerApplications` ADD CONSTRAINT `sellerApplications_reviewedByUserId_users_id_fk` FOREIGN KEY (`reviewedByUserId`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `accountAuditEvents_target_createdAt_idx` ON `accountAuditEvents` (`targetUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `accountAuditEvents_actor_createdAt_idx` ON `accountAuditEvents` (`actorUserId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `sellerApplications_status_updatedAt_idx` ON `sellerApplications` (`status`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `sellerApplications_reviewer_idx` ON `sellerApplications` (`reviewedByUserId`);
