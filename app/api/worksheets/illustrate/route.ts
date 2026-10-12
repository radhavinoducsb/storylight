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
  illustrationPrompt?: string;
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
  if (params.get("adultConfirmed") !== "true") {
    return new Response("Adult QA confirmation is required", { status: 403 });
  }
  const worksheetId = safePart(params.get("worksheetId") ?? "");
  const sectionId = safePart(params.get("sectionId") ?? "");
  if (!worksheetId || !sectionId) return new Response("Missing image details", { status: 400 });
  const runtime = getRuntimeEnv<{ BUCKET?: BucketLike }>();
  const object = await runtime.BUCKET?.get(`worksheet-scenes/${worksheetId}/${sectionId}.png`);
  if (!object) return new Response("Illustration not found", { status: 404 });
  return new Response(object.body, {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Payload;
    if (!body.adultConfirmed) {
      return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
    }
    const worksheetId = safePart(body.worksheetId ?? "");
    const sectionId = safePart(body.sectionId ?? "");
    const sectionText = body.sectionText?.trim() ?? "";
    if (!body.familyId || !worksheetId || !sectionId || !sectionText || !body.illustrationPrompt) {
      return Response.json({ error: "Missing illustration details." }, { status: 400 });
    }

    const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string; BUCKET?: BucketLike }>();
    if (!runtime.OPENAI_API_KEY || !runtime.BUCKET) {
      return Response.json({ error: "Worksheet illustration generation is not connected." }, { status: 503 });
    }

    const prompt = `Create one rich storybook illustration for an adult QA prototype of a future primary-school language reader.

Worksheet story: ${body.title || "School passage"}
Scene: ${body.sectionTitle || "Reading scene"}
Exact scene description: ${body.illustrationPrompt}
Recurring visual bible: ${body.visualBible || "Luminous hand-painted gouache and watercolor, expressive faces, cinematic light."}
Source passage for fidelity: ${sectionText}

Show only the exact story moment. Keep people, clothing, architecture, landscape and objects culturally respectful and age-appropriate. Make it imaginative, detailed and emotionally engaging. Landscape composition. Do not include written words, captions, labels, speech bubbles, logos, UI or decorative borders.`;

    const imageResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6",
        store: false,
        safety_identifier: body.familyId,
        input: prompt,
        tools: [{ type: "image_generation" }],
      }),
    });
    if (!imageResponse.ok) {
      const detail = await imageResponse.text();
      console.error("Worksheet illustration failed", imageResponse.status, detail.slice(0, 500));
      return Response.json({ error: "This scene illustration could not be created." }, { status: 502 });
    }
    const raw = (await imageResponse.json()) as { output?: Array<{ type?: string; result?: string }> };
    const base64 = raw.output?.find((item) => item.type === "image_generation_call")?.result;
    if (!base64) return Response.json({ error: "The illustration agent returned no image." }, { status: 502 });

    const key = `worksheet-scenes/${worksheetId}/${sectionId}.png`;
    await runtime.BUCKET.put(key, decodeBase64(base64), { httpMetadata: { contentType: "image/png" } });
    return Response.json({
      imageUrl: `/api/worksheets/illustrate?worksheetId=${encodeURIComponent(worksheetId)}&sectionId=${encodeURIComponent(sectionId)}&adultConfirmed=true`,
    });
  } catch (error) {
    console.error("Worksheet illustration route failed", error);
    return Response.json({ error: "This worksheet scene could not be illustrated." }, { status: 500 });
  }
}

