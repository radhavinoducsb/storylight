import { responseOutputText } from "../../../../lib/openai-response";
import { getRuntimeEnv } from "../../../../runtime-env";

type Payload = {
  adultConfirmed?: boolean;
  familyId?: string;
  language?: "ta" | "zh";
  level?: "P3" | "P5";
  question?: string;
  storyContext?: string;
  existingStems?: string[];
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as Payload;
    if (!body.adultConfirmed) return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
    const question = body.question?.trim() ?? "";
    const storyContext = body.storyContext?.trim() ?? "";
    if (!body.familyId || !body.language || !body.level || !question || !storyContext) {
      return Response.json({ error: "Missing story-help details." }, { status: 400 });
    }
    if (question.length > 500 || storyContext.length > 1800) {
      return Response.json({ error: "This story section is too long for one help card." }, { status: 400 });
    }

    const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string }>();
    if (!runtime.OPENAI_API_KEY) return Response.json({ error: "OpenAI story help is not connected." }, { status: 503 });
    const targetLanguage = body.language === "ta" ? "Tamil" : "Mandarin Chinese";
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        question_meaning: { type: "string" },
        key_phrase: { type: "string" },
        key_phrase_meaning: { type: "string" },
        story_clue: { type: "string" },
        clue_connection: { type: "string" },
        answer_frame: { type: "string" },
      },
      required: ["question_meaning", "key_phrase", "key_phrase_meaning", "story_clue", "clue_connection", "answer_frame"],
    };

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        store: false,
        safety_identifier: body.familyId,
        reasoning: { effort: "low" },
        instructions: `You make a progressive reading-comprehension help card for a ${targetLanguage} ${body.level} learner in an adult-only QA prototype.

The learner did not understand the question. Help them understand before asking them to infer.

Rules:
- question_meaning: a clear, natural English translation of the question. Preserve exactly what it asks.
- key_phrase: copy the one target-language word or short phrase in the question most likely to block understanding, usually its academic verb or relationship phrase.
- key_phrase_meaning: its concise English meaning in this exact question.
- story_clue: copy only the shortest exact clause or sentence from the supplied story that directly helps answer the question. Never return the whole passage. Do not invent or paraphrase this field.
- clue_connection: one plain-English sentence explaining how that clue relates to the question. Do not demand that the learner independently discover the connection again.
- answer_frame: one natural ${targetLanguage} sentence frame that directly mirrors this specific question and contains exactly one visible blank written as _____. It must be usable as an answer, not a generic thinking slogan. Do not copy an unrelated supplied stem.
- Do not add a second sentence starter, a list of possibilities, a score, or a completed answer.`,
        input: JSON.stringify({
          target_language: targetLanguage,
          level: body.level,
          question,
          story_context: storyContext,
          existing_stems_to_replace_if_unhelpful: (body.existingStems ?? []).slice(0, 4),
        }),
        text: { format: { type: "json_schema", name: "progressive_story_help", strict: true, schema } },
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("Story help failed", upstream.status, detail.slice(0, 400));
      return Response.json({ error: "This help card could not be prepared." }, { status: 502 });
    }
    const raw = await upstream.json();
    const output = responseOutputText(raw);
    if (!output) return Response.json({ error: "No story help was returned." }, { status: 502 });
    return Response.json(JSON.parse(output));
  } catch (error) {
    console.error("Story-help route failed", error);
    return Response.json({ error: "Story help is unavailable right now." }, { status: 500 });
  }
}
