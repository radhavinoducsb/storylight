import { getRuntimeEnv } from "../../../runtime-env";

type Language = "ta" | "zh";

function cleanKeyword(value: string) {
  return value.replace(/[<>\r\n]/g, " ").trim().slice(0, 80);
}

function extensionFor(type: string) {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("wav")) return "wav";
  return "webm";
}

export async function POST(request: Request) {
  try {
    const body = await request.formData();
    const audio = body.get("audio");
    const language = body.get("language") as Language | null;
    const adultConfirmed = body.get("adultConfirmed") === "true";

    if (!adultConfirmed) {
      return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
    }
    if (!(audio instanceof File) || !audio.size || (language !== "ta" && language !== "zh")) {
      return Response.json({ error: "A valid Tamil or Mandarin recording is required." }, { status: 400 });
    }
    if (audio.size > 25 * 1024 * 1024) {
      return Response.json({ error: "Please keep each recording under 25 MB." }, { status: 413 });
    }

    const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string }>();
    if (!runtime.OPENAI_API_KEY) {
      return Response.json({ error: "OpenAI transcription is not connected." }, { status: 503 });
    }

    const storyContext = String(body.get("storyContext") ?? "").trim().slice(0, 900);
    const rawWords = String(body.get("targetWords") ?? "");
    const targetWords = rawWords
      .split("\n")
      .map(cleanKeyword)
      .filter(Boolean)
      .slice(0, 12);
    const targetLanguage = language === "ta" ? "Tamil" : "Mandarin Chinese";

    const upstream = new FormData();
    upstream.append("model", "gpt-transcribe");
    upstream.append(
      "file",
      new File([await audio.arrayBuffer()], `storylight-recording.${extensionFor(audio.type)}`, {
        type: audio.type || "audio/webm",
      }),
    );
    upstream.append(
      "prompt",
      `Adult QA recording simulating a Singapore primary learner speaking ${targetLanguage}. Preserve the spoken language and wording. Story context: ${storyContext}`,
    );
    upstream.append("languages[]", language === "ta" ? "ta" : "zh-cn");
    for (const word of targetWords) upstream.append("keywords[]", word);

    const transcriptionResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.OPENAI_API_KEY}` },
      body: upstream,
    });

    if (!transcriptionResponse.ok) {
      const detail = await transcriptionResponse.text();
      console.error("Transcription request failed", transcriptionResponse.status, detail.slice(0, 400));
      return Response.json({ error: "The recording could not be transcribed. Please try again." }, { status: 502 });
    }

    const result = (await transcriptionResponse.json()) as { text?: string };
    const transcript = result.text?.trim() ?? "";
    if (!transcript) {
      return Response.json({ error: "No clear speech was detected. Please record once more." }, { status: 422 });
    }

    return Response.json({ transcript });
  } catch (error) {
    console.error("Transcription failed", error);
    return Response.json({ error: "The recording could not be transcribed." }, { status: 500 });
  }
}
