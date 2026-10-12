import { getRuntimeEnv } from "../../../../runtime-env";

type Language = "ta" | "zh";

function responseText(payload: unknown) {
  const value = payload as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  return (value.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text)
    .join("");
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      adultConfirmed?: boolean;
      familyId?: string;
      language?: Language;
      level?: "P3" | "P5";
      title?: string;
      sourceText?: string;
    };
    if (!body.adultConfirmed) return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
    const familyId = body.familyId?.trim() ?? "";
    const sourceText = body.sourceText?.trim() ?? "";
    if (!familyId || !body.language || !body.level || !sourceText) return Response.json({ error: "A current story is required for the demo." }, { status: 400 });
    if (sourceText.length > 14_000) return Response.json({ error: "This story is too long for a five-word preview." }, { status: 400 });

    const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string }>();
    if (!runtime.OPENAI_API_KEY) return Response.json({ error: "OpenAI word demo is not connected." }, { status: 503 });
    const targetLanguage = body.language === "ta" ? "Tamil" : "Mandarin Chinese";
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        words: {
          type: "array",
          minItems: 5,
          maxItems: 5,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              word: { type: "string" },
              sentence: { type: "string" },
              simple: { type: "string" },
              english: { type: "string" },
              construction: {
                type: "object",
                additionalProperties: false,
                properties: {
                  kind: { type: "string", enum: ["tamil_word_family", "mandarin_compound", "whole_word"] },
                  parts: {
                    type: "array",
                    minItems: 1,
                    maxItems: 4,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: { form: { type: "string" }, pronunciation: { type: "string" }, meaning: { type: "string" } },
                      required: ["form", "pronunciation", "meaning"],
                    },
                  },
                  related_forms: {
                    type: "array",
                    maxItems: 4,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: { form: { type: "string" }, pronunciation: { type: "string" }, meaning: { type: "string" } },
                      required: ["form", "pronunciation", "meaning"],
                    },
                  },
                },
                required: ["kind", "parts", "related_forms"],
              },
              contextual: {
                type: "object",
                additionalProperties: false,
                properties: {
                  selected_form: { type: "string" },
                  canonical_form: { type: "string" },
                  pronunciation: { type: "string" },
                  meaning_here: { type: "string" },
                  source_sentence: { type: "string" },
                  entry_kind: { type: "string", enum: ["word", "expression", "grammar"] },
                  confidence: { type: "string", enum: ["high", "medium"] },
                  needs_clarification: { type: "boolean", enum: [false] },
                  ambiguity_note: { type: "string", enum: [""] },
                },
                required: ["selected_form", "canonical_form", "pronunciation", "meaning_here", "source_sentence", "entry_kind", "confidence", "needs_clarification", "ambiguity_note"],
              },
            },
            required: ["word", "sentence", "simple", "english", "construction", "contextual"],
          },
        },
      },
      required: ["words"],
    };

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": familyId,
      },
      body: JSON.stringify({
        model: "gpt-5.6",
        store: false,
        reasoning: { effort: "medium" },
        instructions: `Select exactly five useful ${targetLanguage} vocabulary items from the supplied ${body.level} story for a child-friendly Magic Backpack demonstration.

Every selected word must occur verbatim in the supplied story. Do not select a character name, punctuation, number, grammatical particle by itself, or an extremely common word with little learning value. Preserve the exact standard script and spelling from the story.

For each word:
- sentence is one short, natural ${targetLanguage} example that uses the word correctly.
- simple is a very short, child-friendly explanation in ${targetLanguage}.
- english is a concise meaning in this story context.
- construction teaches a reliable modern word family or compound, never a guessed historical etymology.
- contextual.selected_form and contextual.canonical_form both repeat the selected complete word or expression. contextual.source_sentence copies the complete sentence from the story that establishes this meaning. contextual.meaning_here is the concise English meaning in that sentence. Set confidence to high or medium, needs_clarification false and ambiguity_note to an empty string; choose a different item if its sense or pronunciation is uncertain.
- Tamil: use tamil_word_family only for a confident base-word/productive-ending or genuine family link; otherwise whole_word. Pronunciation strings stay empty. Silently verify spelling, sandhi, suffixes, case and natural Singapore primary-school Tamil syntax.
- Mandarin: select complete words or short fixed expressions, never a character that is merely part of a word. Determine the meaning and pronunciation from the complete source sentence. Put contextual Hanyu Pinyin with tone marks in contextual.pronunciation, including the reading of any polyphonic character in this sentence. Use mandarin_compound only for a transparent modern compound; otherwise whole_word. Treat idioms as wholes and do not choose a grammatical particle for this demo. Silently verify characters, grammar, word boundaries, contextual meaning and Pinyin.

The five cards are a preview only. Do not mention saving, mastery, scores or the Voice Teacher.`,
        input: JSON.stringify({ story_title: body.title?.slice(0, 300) ?? "Current story", story_text: sourceText }),
        text: { format: { type: "json_schema", name: "magic_backpack_story_demo", strict: true, schema } },
      }),
    });
    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("Magic Backpack demo failed", upstream.status, detail.slice(0, 400));
      return Response.json({ error: "The five-word story demo could not be prepared." }, { status: 502 });
    }
    const raw = await upstream.json();
    const text = responseText(raw);
    if (!text) return Response.json({ error: "No demo words were returned." }, { status: 502 });
    const parsed = JSON.parse(text) as { words?: Array<{ word?: string }> };
    const words = (parsed.words ?? []).filter((item, index, all) => Boolean(item.word?.trim()) && sourceText.includes(item.word!.trim()) && all.findIndex((candidate) => candidate.word?.trim() === item.word?.trim()) === index);
    if (words.length !== 5) return Response.json({ error: "Five verified story words could not be prepared. Try opening the story and retrying." }, { status: 502 });
    return Response.json({ words });
  } catch (error) {
    console.error("Magic Backpack demo error", error);
    return Response.json({ error: "The five-word story demo is unavailable right now." }, { status: 500 });
  }
}
