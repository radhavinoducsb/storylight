import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const storyResponses = sqliteTable(
  "story_responses",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull(),
    storyTitle: text("story_title").notNull(),
    beatId: text("beat_id").notNull(),
    language: text("language").notNull(),
    level: text("level").notNull(),
    kind: text("kind").notNull(),
    prompt: text("prompt").notNull(),
    originalResponse: text("original_response").notNull(),
    correctedResponse: text("corrected_response").notNull(),
    relevance: text("relevance").notNull(),
    grammarStatus: text("grammar_status").notNull(),
    encouragement: text("encouragement").notNull(),
    parentNote: text("parent_note").notNull(),
    retryPrompt: text("retry_prompt").notNull(),
    usedWordsJson: text("used_words_json").notNull().default("[]"),
    shouldRetry: integer("should_retry", { mode: "boolean" }).notNull().default(false),
    aiEvaluated: integer("ai_evaluated", { mode: "boolean" }).notNull().default(false),
    attempt: integer("attempt").notNull().default(1),
    imageKey: text("image_key"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("story_responses_family_created_idx").on(table.familyId, table.createdAt),
    index("story_responses_family_beat_idx").on(table.familyId, table.beatId),
  ],
);

export const worksheetAnalysisCache = sqliteTable(
  "worksheet_analysis_cache",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull(),
    cacheKind: text("cache_kind").notNull(),
    cacheKey: text("cache_key").notNull(),
    language: text("language").notNull(),
    level: text("level").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("worksheet_cache_lookup_idx").on(
      table.familyId,
      table.cacheKind,
      table.cacheKey,
      table.language,
      table.level,
    ),
    index("worksheet_cache_family_updated_idx").on(table.familyId, table.updatedAt),
  ],
);

export const assessmentLearningProfiles = sqliteTable(
  "assessment_learning_profiles",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull(),
    language: text("language").notNull(),
    level: text("level").notNull(),
    assessmentTitle: text("assessment_title").notNull(),
    strengthsJson: text("strengths_json").notNull().default("[]"),
    focusAreasJson: text("focus_areas_json").notNull().default("[]"),
    rubricJson: text("rubric_json").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("assessment_profiles_family_created_idx").on(table.familyId, table.createdAt),
    index("assessment_profiles_family_language_idx").on(table.familyId, table.language),
  ],
);

export const worksheetOriginals=sqliteTable('worksheet_originals',{id:text('id').notNull(),familyId:text('family_id').notNull(),name:text('name').notNull(),mime:text('mime').notNull(),objectKey:text('object_key').notNull()},t=>[uniqueIndex('worksheet_originals_family_id').on(t.familyId,t.id)]);
export const worksheetSavedSets=sqliteTable('worksheet_saved_sets',{familyId:text('family_id').notNull(),cacheKey:text('cache_key').notNull(),title:text('title').notNull(),language:text('language').notNull(),level:text('level').notNull(),pagesJson:text('pages_json').notNull(),updatedAt:text('updated_at').notNull()},t=>[uniqueIndex('worksheet_saved_sets_family_key').on(t.familyId,t.cacheKey)]);
