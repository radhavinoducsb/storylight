import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { storyResponses } from "../../../db/schema";
import { ensureStoryResponsesSchema } from "../../../db/story-responses";
import { getRuntimeEnv } from "../../../runtime-env";

type IllustrationPayload = {
  adultConfirmed?: boolean;
  familyId?: string;
  responseId?: string;
  storyTitle?: string;
  language?: "ta" | "zh";
  level?: "P3" | "P5";
  narration?: string;
};

type BucketLike = {
  get: (key: string) => Promise<{ body: ReadableStream<Uint8Array> } | null>;
  put: (key: string, value: Uint8Array, options: { httpMetadata: { contentType: string } }) => Promise<unknown>;
};

function decodeBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function GET(request: Request) {
  await ensureStoryResponsesSchema();
  const params = new URL(request.url).searchParams;
  if (params.get("adultConfirmed") !== "true") {
    return new Response("Adult QA confirmation is required", { status: 403 });
  }
  const id = params.get("id")?.trim();
  const familyId = params.get("familyId")?.trim();
  if (!id || !familyId) return new Response("Missing image details", { status: 400 });

  const [row] = await getDb()
    .select({ imageKey: storyResponses.imageKey })
    .from(storyResponses)
    .where(and(eq(storyResponses.id, id), eq(storyResponses.familyId, familyId)))
    .limit(1);
  if (!row?.imageKey) return new Response("Illustration not found", { status: 404 });

  const runtime = getRuntimeEnv<{ BUCKET?: BucketLike }>();
  const object = await runtime.BUCKET?.get(row.imageKey);
  if (!object) return new Response("Illustration not found", { status: 404 });
  return new Response(object.body, {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" },
  });
}

export async function POST(request: Request) {
  await ensureStoryResponsesSchema();
  const body = (await request.json()) as IllustrationPayload;
  const familyId = body.familyId?.trim() ?? "";
  const responseId = body.responseId?.trim() ?? "";
  const narration = body.narration?.trim() ?? "";
  if (!body.adultConfirmed) {
    return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
  }
  if (!familyId || !responseId || !body.storyTitle || !body.language || !body.level || !narration) {
    return Response.json({ error: "Missing illustration details" }, { status: 400 });
  }
  if (narration.length > 2500) {
    return Response.json({ error: "Please keep the ending under 2,500 characters." }, { status: 400 });
  }

  const [record] = await getDb()
    .select({ id: storyResponses.id })
    .from(storyResponses)
    .where(and(eq(storyResponses.id, responseId), eq(storyResponses.familyId, familyId)))
    .limit(1);
  if (!record) return Response.json({ error: "Saved ending not found" }, { status: 404 });

  const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string; BUCKET?: BucketLike }>();
  if (!runtime.OPENAI_API_KEY) {
    return Response.json(
      { error: "OpenAI illustration generation is not connected." },
      { status: 503 },
    );
  }
  if (!runtime.BUCKET) return Response.json({ error: "Illustration storage is unavailable." }, { status: 503 });

  const languageName = body.language === "ta" ? "Tamil" : "Mandarin Chinese";
  const prompt = `Create a richly illustrated children's storybook scene from an adult QA tester's simulated learner ending.
Story: ${body.storyTitle}. Language: ${languageName}. Reading level: ${body.level}.
Adult tester's narration: ${narration}

Show the narrated idea faithfully as one coherent dramatic scene. Use luminous hand-painted gouache and watercolor, expressive faces, cinematic light, culturally respectful period details, and a sense of wonder. Keep the mood suitable for a future primary-school learning product. Do not include written words, captions, speech bubbles, UI, logos, or a decorative border. Landscape composition.`;

  const imageResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.6",
      store: false,
      safety_identifier: familyId,
      input: prompt,
      tools: [{ type: "image_generation" }],
    }),
  });
  if (!imageResponse.ok) {
    const detail = await imageResponse.text();
    return Response.json({ error: `The illustration could not be created: ${detail.slice(0, 220)}` }, { status: 502 });
  }
  const raw = (await imageResponse.json()) as { output?: Array<{ type?: string; result?: string }> };
  const base64 = raw.output?.find((item) => item.type === "image_generation_call")?.result;
  if (!base64) return Response.json({ error: "The illustration agent returned no image." }, { status: 502 });

  const imageKey = `story-endings/${familyId}/${responseId}.png`;
  await runtime.BUCKET.put(imageKey, decodeBase64(base64), { httpMetadata: { contentType: "image/png" } });
  await getDb()
    .update(storyResponses)
    .set({ imageKey })
    .where(and(eq(storyResponses.id, responseId), eq(storyResponses.familyId, familyId)));

  return Response.json({
    imageUrl: `/api/illustrations?id=${encodeURIComponent(responseId)}&familyId=${encodeURIComponent(familyId)}&adultConfirmed=true`,
  });
}
