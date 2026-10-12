CREATE TABLE `worksheet_originals` (
	`id` text NOT NULL,
	`family_id` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`object_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worksheet_originals_family_id` ON `worksheet_originals` (`family_id`,`id`);--> statement-breakpoint
CREATE TABLE `worksheet_saved_sets` (
	`family_id` text NOT NULL,
	`cache_key` text NOT NULL,
	`title` text NOT NULL,
	`language` text NOT NULL,
	`level` text NOT NULL,
	`pages_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worksheet_saved_sets_family_key` ON `worksheet_saved_sets` (`family_id`,`cache_key`);