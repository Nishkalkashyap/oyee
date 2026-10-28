CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`platform` text NOT NULL,
	`token_hash` text,
	`fcm_token` text,
	`web_push` text,
	`web_push_endpoint` text,
	`created_at` text NOT NULL,
	`last_seen_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "devices_platform" CHECK("devices"."platform" IN ('android', 'ios', 'macos', 'web'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_token_hash_unique` ON `devices` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `devices_web_push_endpoint_unique` ON `devices` (`web_push_endpoint`);--> statement-breakpoint
CREATE INDEX `devices_user` ON `devices` (`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`code_verifier` text NOT NULL,
	`redirect` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pairing_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`prefix` text NOT NULL,
	`hash` text NOT NULL,
	`default_source` text,
	`callback_secret` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tokens_kind" CHECK("tokens"."kind" IN ('webhook', 'mcp'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_hash_unique` ON `tokens` (`hash`);--> statement-breakpoint
CREATE INDEX `tokens_user` ON `tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`google_sub` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_google_sub_unique` ON `users` (`google_sub`);