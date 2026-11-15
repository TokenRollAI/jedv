CREATE TABLE `mail_inbound_receipts` (
	`source_namespace` text NOT NULL,
	`source_event_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`local_event_id` text NOT NULL,
	`received_at` integer NOT NULL,
	PRIMARY KEY(`source_namespace`, `source_event_id`),
	FOREIGN KEY (`local_event_id`) REFERENCES `mail_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `mail_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`target_peer_id` text NOT NULL,
	`remote_team_id` text NOT NULL,
	`remote_to` text NOT NULL,
	`envelope_json` text NOT NULL,
	`status` text NOT NULL,
	`inflight_token` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`acked_at` integer,
	`remote_event_id` text,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `mail_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_peer_id`) REFERENCES `peer_hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_outbox_event_peer_unique` ON `mail_outbox` (`event_id`,`target_peer_id`);--> statement-breakpoint
CREATE INDEX `mail_outbox_dispatch_idx` ON `mail_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `mail_provider_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`extension_id` text,
	`team_id` text NOT NULL,
	`allowed_to` text NOT NULL,
	`type_prefix` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_hint` text NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_provider_tokens_token_hash_unique` ON `mail_provider_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `mobile_pairing_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mobile_pairing_codes_code_hash_unique` ON `mobile_pairing_codes` (`code_hash`);--> statement-breakpoint
CREATE TABLE `mobile_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`csrf_token` text NOT NULL,
	`secure_cookie` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mobile_sessions_token_hash_unique` ON `mobile_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mobile_sessions_expiry_idx` ON `mobile_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `mobile_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`public_origin` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "mobile_settings_singleton" CHECK("mobile_settings"."id"=1)
);
--> statement-breakpoint
CREATE TABLE `peer_hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`origin` text NOT NULL,
	`inbound_token_hash` text NOT NULL,
	`outbound_token_hint` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `peer_hosts_origin_unique` ON `peer_hosts` (`origin`);