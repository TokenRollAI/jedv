CREATE TABLE `mail_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`recipient_member_id` text NOT NULL,
	`read_at` integer,
	`acked_at` integer,
	`nudge_state` text NOT NULL,
	`inflight_token` text,
	`wake_batch_id` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`nudged_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `mail_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_member_id`) REFERENCES `team_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_deliveries_recipient_unique` ON `mail_deliveries` (`event_id`,`recipient_member_id`);--> statement-breakpoint
CREATE INDEX `mail_deliveries_inbox_idx` ON `mail_deliveries` (`recipient_member_id`,`nudge_state`,`created_at`);--> statement-breakpoint
CREATE TABLE `mail_events` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`reply_to_event_id` text,
	`wake_batch_id` text,
	`type` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`hop_count` integer DEFAULT 0 NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`payload_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_events_dedupe_unique` ON `mail_events` (`team_id`,`source_kind`,`source_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `mail_events_thread_idx` ON `mail_events` (`thread_id`);--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`operation_id` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`request_json` text NOT NULL,
	`planned_workspace_id` text,
	`workspace_id` text,
	`planned_terminal_id` text,
	`terminal_id` text,
	`agent_id` text NOT NULL,
	`definition_id` text,
	`expected_launch_id` text,
	`bound_started_at` integer,
	`bound_agent_session_id` text,
	`task_summary` text NOT NULL,
	`joined_at` integer NOT NULL,
	`ended_at` integer,
	`last_error` text,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`terminal_id`) REFERENCES `terminal_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_name_unique` ON `team_members` (`team_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_operation_unique` ON `team_members` (`team_id`,`operation_id`);--> statement-breakpoint
CREATE INDEX `team_members_terminal_idx` ON `team_members` (`terminal_id`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`goal` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`origin_workspace_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`stopped_at` integer,
	`archived_at` integer,
	FOREIGN KEY (`origin_workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
