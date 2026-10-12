import { getRuntimeEnv } from "../../../../runtime-env";

type NarratorVoice = "marin" | "cedar";
type SpeechMode = "story" | "sentence" | "word";

function performanceDirection(language: "ta" | "zh", mode: SpeechMode) {
  if (mode === "word") {
    return language === "ta"
      ? "Pronounce the supplied Tamil word or short phrase exactly once. Be clear and slightly slower than conversation, but keep natural Tamil vowel length and rhythm. Do not translate, explain, spell, add, or repeat anything."
      : "Pronounce the supplied Mandarin word or short phrase exactly once with accurate tones. Be clear and slightly slower than conversation, but sound natural rather than mechanical. Do not translate, explain, spell, add, or repeat anything.";
  }

  const shared = "Read the supplied text exactly as written. Do not translate, paraphrase, add, omit, introduce, or explain anything. Sound like a warm human storyteller reading with a family: intimate, attentive, and emotionally responsive without becoming theatrical or sing-song. Follow the meaning and punctuation with natural pauses, varied phrasing, and conversational pacing. Never use exaggerated slow speech or a classroom-recitation cadence.";
  return language === "ta"
    ? `${shared} Speak in natural, fluent Tamil with careful vowel length, consonants, and Tamil sentence rhythm.`
    : `${shared} Speak in natural, fluent Standard Mandarin familiar to listeners in Singapore, with accurate tones and Mandarin sentence rhythm.`;
}

type SpeechRequest = {
    adultConfirmed?: boolean;
    text?: string;
    language?: "ta" | "zh";
    voice?: NarratorVoice;
    mode?: SpeechMode;
    includeTimings?: boolean;
};

type WordTiming = { word: string; start: number; end: number };

function encodeBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

async function wordTimings(audio: ArrayBuffer, language: "ta" | "zh", apiKey: string): Promise<WordTiming[]> {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/mpeg" }), "narration.mp3");
  form.append("model", "whisper-1");
  form.append("language", language);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "OpenAI-Safety-Identifier": "storylight-adult-qa",
    },
    body: form,
  });
  if (!response.ok) return [];

  const result = await response.json() as { words?: Array<{ word?: unknown; start?: unknown; end?: unknown }> };
  if (!Array.isArray(result.words)) return [];
  return result.words.flatMap((item) => {
    const word = typeof item.word === "string" ? item.word.trim() : "";
    const start = typeof item.start === "number" ? item.start : Number.NaN;
    const end = typeof item.end === "number" ? item.end : Number.NaN;
    return word && Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? [{ word, start, end }]
      : [];
  });
}

async function createSpeech(body: SpeechRequest, cacheOnDevice = false) {

  if (!body.adultConfirmed) {
    return Response.json({ error: "Adult confirmation is required." }, { status: 403 });
  }

  const text = body.text?.trim() ?? "";
  if (!text) return Response.json({ error: "Text is required." }, { status: 400 });
  if (text.length > 6000) {
    return Response.json({ error: "This section is too long to narrate in one request." }, { status: 413 });
  }

  const language = body.language === "zh" ? "zh" : "ta";
  const voice: NarratorVoice = body.voice === "cedar" ? "cedar" : "marin";
  const mode: SpeechMode = body.mode === "word" || body.mode === "sentence" ? body.mode : "story";
  const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string }>();
  if (!runtime.OPENAI_API_KEY) {
    return Response.json({ error: "OpenAI narration is not connected." }, { status: 503 });
  }

  const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": "storylight-adult-qa",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      instructions: performanceDirection(language, mode),
      response_format: "mp3",
    }),
  });

  if (!upstream.ok) {
    return Response.json({ error: "OpenAI could not create this narration." }, { status: upstream.status });
  }

  if (body.includeTimings && mode !== "word") {
    const audio = await upstream.arrayBuffer();
    let words: WordTiming[] = [];
    try {
      words = await wordTimings(audio, language, runtime.OPENAI_API_KEY);
    } catch {
      // Narration should remain available even if timestamp alignment is temporarily unavailable.
    }
    return Response.json({
      audioBase64: encodeBase64(audio),
      words,
    }, {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": cacheOnDevice ? "private, max-age=86400" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  return createSpeech(await request.json() as SpeechRequest);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mode = params.get("mode");
  if (mode !== "word") return Response.json({ error: "Streaming GET is available for word pronunciation only." }, { status: 400 });
  return createSpeech({
    adultConfirmed: params.get("adultConfirmed") === "true",
    text: params.get("text") ?? "",
    language: params.get("language") === "zh" ? "zh" : "ta",
    voice: params.get("voice") === "cedar" ? "cedar" : "marin",
    mode: "word",
  }, true);
}
