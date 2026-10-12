import { getRuntimeEnv } from "../runtime-env";

type PreparedStatementLike = {
  bind: (...values: unknown[]) => PreparedStatementLike;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};

type D1Like = {
  prepare: (statement: string) => PreparedStatementLike;
};

type CacheKind = "set" | "batch";

let initialized = false;

function getCacheDb() {
  const runtime = getRuntimeEnv<{ DB?: D1Like }>();
  if (!runtime.DB) throw new Error("Worksheet cache storage is unavailable.");
  return runtime.DB;
}

export async function ensureWorksheetCacheSchema() {
  if (initialized) return;
  const db = getCacheDb();
  await db.prepare(`CREATE TABLE IF NOT EXISTS worksheet_analysis_cache (
      id text PRIMARY KEY NOT NULL,
      family_id text NOT NULL,
      cache_kind text NOT NULL,
      cache_key text NOT NULL,
      language text NOT NULL,
      level text NOT NULL,
      payload_json text NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS worksheet_cache_lookup_idx ON worksheet_analysis_cache (family_id, cache_kind, cache_key, language, level)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS worksheet_cache_family_updated_idx ON worksheet_analysis_cache (family_id, updated_at)").run();
  initialized = true;
}

export async function readWorksheetCache(
  familyId: string,
  cacheKind: CacheKind,
  cacheKey: string,
  language: string,
  level: string,
) {
  await ensureWorksheetCacheSchema();
  const row = await getCacheDb()
    .prepare(`SELECT payload_json, updated_at
      FROM worksheet_analysis_cache
      WHERE family_id = ? AND cache_kind = ? AND cache_key = ? AND language = ? AND level = ?
      LIMIT 1`)
    .bind(familyId, cacheKind, cacheKey, language, level)
    .first<{ payload_json: string; updated_at: string }>();
  if (!row) return null;
  return { payload: JSON.parse(row.payload_json) as unknown, updatedAt: row.updated_at };
}

export async function writeWorksheetCache(
  familyId: string,
  cacheKind: CacheKind,
  cacheKey: string,
  language: string,
  level: string,
  payload: unknown,
) {
  await ensureWorksheetCacheSchema();
  const earlier=await readWorksheetCache(familyId,cacheKind,cacheKey,language,level);
  const transcripts=(value:any):string=>JSON.stringify(value?.extracted?.passage_text??value?.pages?.map((p:any)=>p.transcript)??value?.batches?.map((b:any)=>b.extracted?.passage_text)??null);
  const previous=earlier?.payload as any;
  if(previous&&payload&&typeof payload==='object'&&transcripts(previous)!=='null'&&transcripts(previous)!==transcripts(payload)){
    const runtime=getRuntimeEnv<{BUCKET?:{put:(key:string,value:string,options?:unknown)=>Promise<unknown>}}>();
    if(!runtime.BUCKET)throw Error('Reading history could not be saved. Your earlier reading is unchanged.');
    const historyKey=`${familyId}/reading-history/${crypto.randomUUID()}.json`;
    await runtime.BUCKET.put(historyKey,JSON.stringify({at:new Date().toISOString(),cacheKind,cacheKey,language,level,payload:previous}),{httpMetadata:{contentType:'application/json'}});
    payload={...payload,readingHistoryKey:historyKey};
  }else if(previous?.readingHistoryKey&&payload&&typeof payload==='object')payload={...payload,readingHistoryKey:previous.readingHistoryKey};
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await getCacheDb()
    .prepare(`INSERT INTO worksheet_analysis_cache
      (id, family_id, cache_kind, cache_key, language, level, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(family_id, cache_kind, cache_key, language, level)
      DO UPDATE SET payload_json = excluded.payload_json, updated_at = CURRENT_TIMESTAMP`)
    .bind(id, familyId, cacheKind, cacheKey, language, level, JSON.stringify(payload))
    .run();
}

export async function clearWorksheetCache(familyId: string) {
  await ensureWorksheetCacheSchema();
  await getCacheDb()
    .prepare("DELETE FROM worksheet_analysis_cache WHERE family_id = ?")
    .bind(familyId)
    .run();
}
