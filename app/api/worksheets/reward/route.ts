import { getRuntimeEnv } from "../../../../runtime-env";

type Payload = {
  adultConfirmed?: boolean;
  familyId?: string;
  worksheetId?: string;
  sectionId?: string;
  title?: string;
  sectionTitle?: string;
  sectionText?: string;
  visualBible?: string;
  language?: "ta" | "zh";
  level?: "P3" | "P5";
  mode?: "ending" | "scene" | "comic";
  narration?: string;
};

type BucketObject = { body: ReadableStream<Uint8Array> };
type BucketLike = {
  get: (key: string) => Promise<BucketObject | null>;
  put: (key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }) => Promise<unknown>;
};

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function safePart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get("adultConfirmed") !== "true") return new Response("Adult QA confirmation is required", { status: 403 });
  const worksheetId = safePart(params.get("worksheetId") ?? "");
  const rewardId = safePart(params.get("rewardId") ?? "");
  if (!worksheetId || !rewardId) return new Response("Missing reward details", { status: 400 });
  const runtime = getRuntimeEnv<{ BUCKET?: BucketLike }>();
  const object = await runtime.BUCKET?.get(`worksheet-rewards/${worksheetId}/${rewardId}.png`);
  if (!object) return new Response("Reward image not found", { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Payload;
    if (!body.adultConfirmed) return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
    const worksheetId = safePart(body.worksheetId ?? "");
    const sectionId = safePart(body.sectionId ?? "");
    const narration = body.narration?.trim() ?? "";
    const mode = body.mode === "comic" ? "comic" : body.mode === "ending" ? "ending" : "scene";
    if (!body.familyId || !worksheetId || !sectionId || !narration || !body.sectionText) {
      return Response.json({ error: "Missing adventure-break details." }, { status: 400 });
    }
    if (narration.length > 1800) return Response.json({ error: "Keep the narration under 1,800 characters." }, { status: 400 });

    const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string; BUCKET?: BucketLike }>();
    if (!runtime.OPENAI_API_KEY || !runtime.BUCKET) return Response.json({ error: "Creative rewards are not connected." }, { status: 503 });

    const shared = `Source: ${body.title || "School passage"}, section ${body.sectionTitle || sectionId}.
Source passage: ${body.sectionText}
Adult tester's narration: ${narration}
Visual continuity: ${body.visualBible || "Luminous hand-painted gouache and watercolor, expressive faces, cinematic light."}

Keep the result culturally respectful and suitable for a future primary-school language reader. Follow the tester's idea while remaining consistent with the supplied passage. Do not add written words, captions, labels, speech bubbles, logos or interface elements.`;
    const prompt = mode === "comic"
      ? `Create a single landscape, three-panel wordless comic strip. Each panel should show a distinct moment from the narration, in clear chronological order. Use clean panel divisions and energetic visual storytelling. ${shared}`
      : mode === "ending"
        ? `Create one rich landscape storybook illustration showing the decisive final moment of the adult tester's alternate ending. The new ending may differ from the source, but character appearance and established story facts before the divergence must remain consistent. Make the result emotionally engaging, detailed and full of wonder. ${shared}`
        : `Create one rich landscape storybook illustration of the moment described by the tester. Make it emotionally engaging, detailed and full of wonder. ${shared}`;

    const imageResponse = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt,
        size: "1536x1024",
        quality: "medium",
        output_format: "png",
      }),
    });
    if (!imageResponse.ok) {
      const detail = await imageResponse.text();
      console.error("Adventure reward generation failed", imageResponse.status, detail.slice(0, 500));
      return Response.json({ error: "The creative reward could not be generated this time." }, { status: 502 });
    }
    const raw = await imageResponse.json() as { data?: Array<{ b64_json?: string }> };
    const base64 = raw.data?.[0]?.b64_json;
    if (!base64) return Response.json({ error: "The image agent returned no picture." }, { status: 502 });

    const rewardId = safePart(`${sectionId}-${mode}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`);
    await runtime.BUCKET.put(`worksheet-rewards/${worksheetId}/${rewardId}.png`, decodeBase64(base64), { httpMetadata: { contentType: "image/png" } });
    return Response.json({ imageUrl: `/api/worksheets/reward?worksheetId=${encodeURIComponent(worksheetId)}&rewardId=${encodeURIComponent(rewardId)}&adultConfirmed=true` });
  } catch (error) {
    console.error("Adventure reward route failed", error);
    return Response.json({ error: "The adventure reward could not be created." }, { status: 500 });
  }
}
