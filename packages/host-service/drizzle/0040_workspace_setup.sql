CREATE TABLE `workspace_setup` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`terminal_id` text,
	`status` text NOT NULL,
	`exit_code` integer,
	`exit_signal` integer,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
