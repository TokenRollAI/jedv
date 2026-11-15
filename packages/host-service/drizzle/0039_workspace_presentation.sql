CREATE TABLE `workspace_presentation` (
	`workspace_id` text NOT NULL,
	`user_id` text DEFAULT '' NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`position` integer,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
