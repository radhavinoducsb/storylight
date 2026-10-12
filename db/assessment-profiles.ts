import { getRuntimeEnv } from "../runtime-env";

type D1Statement = { bind: (...values: unknown[]) => D1Statement; run: () => Promise<unknown>; first: <T>() => Promise<T | null> };
type D1Like = { prepare: (sql: string) => D1Statement };

export async function saveAssessmentProfile(input: { familyId: string; language: string; level: string; title: string; strengths: string[]; focusAreas: string[]; rubric: unknown[] }) {
  const runtime = getRuntimeEnv<{ DB?: D1Like }>();
  if (!runtime.DB) throw new Error("Assessment profile storage is unavailable.");
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await runtime.DB.prepare(`INSERT INTO assessment_learning_profiles (id, family_id, language, level, assessment_title, strengths_json, focus_areas_json, rubric_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, input.familyId, input.language, input.level, input.title, JSON.stringify(input.strengths), JSON.stringify(input.focusAreas), JSON.stringify(input.rubric)).run();
  return id;
}

export async function readLatestAssessmentProfile(familyId: string, language: string, level: string) {
  const runtime = getRuntimeEnv<{ DB?: D1Like }>();
  if (!runtime.DB) throw new Error("Assessment profile storage is unavailable.");
  const row = await runtime.DB.prepare(`SELECT assessment_title, strengths_json, focus_areas_json, created_at FROM assessment_learning_profiles WHERE family_id = ? AND language = ? AND level = ? ORDER BY created_at DESC LIMIT 1`).bind(familyId, language, level).first<{ assessment_title: string; strengths_json: string; focus_areas_json: string; created_at: string }>();
  if (!row) return null;
  return { title: row.assessment_title, strengths: JSON.parse(row.strengths_json) as string[], focusAreas: JSON.parse(row.focus_areas_json) as string[], createdAt: row.created_at };
}
