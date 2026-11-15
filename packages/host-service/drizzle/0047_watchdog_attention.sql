ALTER TABLE `watchdog_alerts` ADD `group_key` text;--> statement-breakpoint
ALTER TABLE `watchdog_alerts` ADD `severity` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `watchdog_alerts` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `watchdog_alerts` ADD `workspace_id` text;--> statement-breakpoint
ALTER TABLE `watchdog_alerts` ADD `terminal_id` text;--> statement-breakpoint
ALTER TABLE `watchdog_alerts` ADD `member_id` text;--> statement-breakpoint
ALTER TABLE `watchdog_alerts` ADD `mail_delivery_id` text;--> statement-breakpoint
ALTER TABLE `watchdog_alerts` ADD `automation_id` text;--> statement-breakpoint
ALTER TABLE `watchdog_alerts` ADD `automation_run_id` text;--> statement-breakpoint
ALTER TABLE `watchdog_alerts` ADD `ignored_at` integer;--> statement-breakpoint
ALTER TABLE `watchdog_alerts` ADD `ignore_reason` text;--> statement-breakpoint
ALTER TABLE `watchdog_alerts` ADD `resolved_at` integer;--> statement-breakpoint
CREATE INDEX `idx_watchdog_alerts_group` ON `watchdog_alerts` (`group_key`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `idx_watchdog_alerts_state` ON `watchdog_alerts` (`resolved_at`,`ignored_at`,`read_at`,`severity`);