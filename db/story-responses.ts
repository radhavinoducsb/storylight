import { getRuntimeEnv } from "../runtime-env";

type D1Like = {
  prepare: (statement: string) => { run: () => Promise<unknown> };
};

let initialized = false;

export async function ensureStoryResponsesSchema() {
  if (initialized) return;
  const runtime = getRuntimeEnv<{ DB?: D1Like }>();
  if (!runtime.DB) throw new Error("Story journal storage is unavailable.");
  const db = runtime.DB;
  await db.prepare(`CREATE TABLE IF NOT EXISTS story_responses (
      id text PRIMARY KEY NOT NULL,
      family_id text NOT NULL,
      story_title text NOT NULL,
      beat_id text NOT NULL,
      language text NOT NULL,
      level text NOT NULL,
      kind text NOT NULL,
      prompt text NOT NULL,
      original_response text NOT NULL,
      corrected_response text NOT NULL,
      relevance text NOT NULL,
      grammar_status text NOT NULL,
      encouragement text NOT NULL,
      parent_note text NOT NULL,
      retry_prompt text NOT NULL,
      used_words_json text DEFAULT '[]' NOT NULL,
      should_retry integer DEFAULT false NOT NULL,
      ai_evaluated integer DEFAULT false NOT NULL,
      attempt integer DEFAULT 1 NOT NULL,
      image_key text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS story_responses_family_created_idx ON story_responses (family_id, created_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS story_responses_family_beat_idx ON story_responses (family_id, beat_id)").run();
  initialized = true;
}
