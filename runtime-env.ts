export type StorylightRuntimeEnv = {
  DB?: unknown;
  BUCKET?: unknown;
  OPENAI_API_KEY?: string;
};

const ENV_KEY = "__STORYLIGHT_RUNTIME_ENV__";

export function setRuntimeEnv(value: StorylightRuntimeEnv) {
  (globalThis as unknown as Record<string, unknown>)[ENV_KEY] = value;
}

export function getRuntimeEnv<T extends StorylightRuntimeEnv = StorylightRuntimeEnv>() {
  const value = (globalThis as unknown as Record<string, unknown>)[ENV_KEY];
  return (value && typeof value === "object" ? value : {}) as T;
}
