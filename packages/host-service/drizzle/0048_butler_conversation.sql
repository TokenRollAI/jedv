CREATE TABLE `butler_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`current_thread_id` text,
	`initialized_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`current_thread_id`) REFERENCES `butler_threads`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "butler_state_singleton" CHECK("butler_state"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE `butler_threads` ADD `kind` text DEFAULT 'conversation' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_butler_threads_kind_updated` ON `butler_threads` (`kind`,"updated_at" desc);--> statement-breakpoint
ALTER TABLE `butler_turns` ADD `new_topic` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `butler_turns` ADD `context_json` text;--> statement-breakpoint
CREATE INDEX `idx_butler_approvals_thread_created` ON `butler_approvals` (`thread_id`,"created_at" desc);