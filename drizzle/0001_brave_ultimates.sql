CREATE TABLE `worksheet_analysis_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`cache_kind` text NOT NULL,
	`cache_key` text NOT NULL,
	`language` text NOT NULL,
	`level` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worksheet_cache_lookup_idx` ON `worksheet_analysis_cache` (`family_id`,`cache_kind`,`cache_key`,`language`,`level`);--> statement-breakpoint
CREATE INDEX `worksheet_cache_family_updated_idx` ON `worksheet_analysis_cache` (`family_id`,`updated_at`);