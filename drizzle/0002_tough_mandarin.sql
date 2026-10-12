CREATE TABLE `assessment_learning_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`language` text NOT NULL,
	`level` text NOT NULL,
	`assessment_title` text NOT NULL,
	`strengths_json` text DEFAULT '[]' NOT NULL,
	`focus_areas_json` text DEFAULT '[]' NOT NULL,
	`rubric_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assessment_profiles_family_created_idx` ON `assessment_learning_profiles` (`family_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `assessment_profiles_family_language_idx` ON `assessment_learning_profiles` (`family_id`,`language`);