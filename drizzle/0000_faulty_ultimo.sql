CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`result` text
);
--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_records_session_kind_created` ON `records` (`session_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`oauth` text,
	`oauth_state` text,
	`oauth_expires` integer
);
