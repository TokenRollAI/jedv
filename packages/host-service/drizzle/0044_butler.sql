CREATE TABLE `butler_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`request_id` text NOT NULL,
	`action_type` text NOT NULL,
	`target_id` text NOT NULL,
	`summary` text NOT NULL,
	`canonical_payload_json` text NOT NULL,
	`payload_hash` text NOT NULL,
	`target_state_hash` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`resolved_at` integer,
	`error` text,
	FOREIGN KEY (`thread_id`) REFERENCES `butler_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `butler_approvals_status_expiry` ON `butler_approvals` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `butler_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`request_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `butler_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `butler_messages_thread_created` ON `butler_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `butler_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `butler_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`human_text` text NOT NULL,
	`status` text NOT NULL,
	`result_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `butler_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `butler_turns_request` ON `butler_turns` (`id`);