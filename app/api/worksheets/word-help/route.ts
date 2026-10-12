import { getRuntimeEnv } from "../../../../runtime-env";
import { responseOutputText } from "../../../../lib/openai-response";

type Payload = {
  adultConfirmed?: boolean;
  familyId?: string;
  language?: "ta" | "zh";
  level?: "P3" | "P5";
  word?: string;
  context?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Payload;
    if (!body.adultConfirmed) {
      return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
    }
    const word = body.word?.trim() ?? "";
    const context = body.context?.trim() ?? "";
    if (!body.familyId || !body.language || !body.level || !word || !context) {
      return Response.json({ error: "Missing word-help details." }, { status: 400 });
    }
    if (word.length > 80 || context.length > 5000) {
      return Response.json({ error: "The selected word or sentence is too long." }, { status: 400 });
    }

    const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string }>();
    if (!runtime.OPENAI_API_KEY) {
      return Response.json({ error: "OpenAI word help is not connected." }, { status: 503 });
    }
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
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
                properties: {
                  form: { type: "string" },
                  pronunciation: { type: "string" },
                  meaning: { type: "string" },
                },
                required: ["form", "pronunciation", "meaning"],
              },
            },
            related_forms: {
              type: "array",
              maxItems: 4,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  form: { type: "string" },
                  pronunciation: { type: "string" },
                  meaning: { type: "string" },
                },
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
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            needs_clarification: { type: "boolean" },
            ambiguity_note: { type: "string" },
          },
          required: ["selected_form", "canonical_form", "pronunciation", "meaning_here", "source_sentence", "entry_kind", "confidence", "needs_clarification", "ambiguity_note"],
        },
      },
      required: ["sentence", "simple", "english", "construction", "contextual"],
    };
    const targetLanguage = body.language === "ta" ? "Tamil" : "Mandarin Chinese";
    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6",
        store: false,
        safety_identifier: body.familyId,
        reasoning: { effort: "medium" },
        instructions: `You create accurate, child-friendly vocabulary help for an adult QA prototype of a future ${targetLanguage} ${body.level} reader.

The selected item may be one character, a word, compound, particle or part of a short expression from a story, question or worksheet. First understand it in the supplied reading context.

contextual describes the exact item that should be taught here.
- selected_form: the smallest complete, meaningful word or fixed expression in the supplied context that contains the selected item. It must be copied exactly from the supplied context. Do not return an isolated character when it is only part of a larger word. Keep it short: normally one word or an expression of no more than six Chinese characters.
- canonical_form: the reusable dictionary form when inflection or sentence grammar changes the surface form; otherwise repeat selected_form.
- pronunciation: contextual pronunciation. For Mandarin use standard Hanyu Pinyin with tone marks, including the pronunciation required by a polyphonic character in this sentence. For Tamil use an empty string.
- meaning_here: a concise English gloss for this exact context, not every possible dictionary meaning.
- source_sentence: copy the complete sentence from the supplied context that establishes the meaning.
- entry_kind: word, expression, or grammar. Use grammar for Mandarin aspect, structural and sentence-final particles whose function is more useful than a dictionary gloss. Use expression for idioms and fixed phrases and teach them as wholes.
- confidence: high only when segmentation, contextual sense and pronunciation are clear; medium when the interpretation is well supported but context is limited; low when multiple readings remain genuinely plausible.
- needs_clarification: true whenever confidence is low or saving one interpretation could teach the wrong meaning.
- ambiguity_note: when clarification is needed, give one short child-friendly sentence explaining what surrounding information is missing. Otherwise return an empty string.

sentence: one new, concrete, easy ${targetLanguage} sentence that uses the selected item naturally and reveals its meaning.
simple: a natural, very short explanation or simpler synonym in ${targetLanguage}. Do not merely repeat the selected item.
english: the concise English meaning in this exact context.

construction must teach how the word can be remembered without inventing an etymology.
- For Tamil, use kind tamil_word_family only when you can confidently show a child-friendly base word plus productive ending, or a genuine family relationship. Do not claim a historical root. Use pronunciation as an empty string. Include useful inflected or related forms in related_forms. If segmentation would be doubtful or misleading, use whole_word with the complete selected item as the only part.
- For Mandarin, never infer meaning from the tapped character alone. Resolve the word or expression from the complete supplied sentence first. Use kind mandarin_compound only when the modern compound is transparently and usefully built from its characters or familiar component words. Give standard Hanyu Pinyin with tone marks in pronunciation. If character-by-character explanation would mislead, use whole_word and teach the complete contextual word or fixed expression plus genuinely common combinations in related_forms. Account for polyphonic characters, tone sandhi and homophones in context.
- Meanings in construction must be extremely short, plain English memory cues. Preserve exact scripts and standard spelling.

Language quality is non-negotiable. Silently check Tamil grammar, sandhi, case, suffixes and idiomatic school usage, or Mandarin grammar, characters and Pinyin, before returning the answer. When uncertain, choose whole_word instead of inventing a decomposition.`,
        input: JSON.stringify({ selected_item: word, worksheet_context: context }),
        text: {
          format: {
            type: "json_schema",
            name: "worksheet_word_help",
            strict: true,
            schema,
          },
        },
      }),
    });
    if (!apiResponse.ok) {
      const detail = await apiResponse.text();
      console.error("Worksheet word help failed", apiResponse.status, detail.slice(0, 400));
      return Response.json({ error: "This word clue could not be prepared." }, { status: 502 });
    }
    const raw = await apiResponse.json();
    const output = responseOutputText(raw);
    if (!output) return Response.json({ error: "No word clue was returned." }, { status: 502 });
    const parsed = JSON.parse(output) as {
      contextual?: {
        selected_form?: string;
        source_sentence?: string;
        confidence?: "high" | "medium" | "low";
        needs_clarification?: boolean;
        ambiguity_note?: string;
      };
    };
    if (body.language === "zh" && parsed.contextual) {
      const selectedForm = parsed.contextual.selected_form?.trim() ?? "";
      const sourceSentence = parsed.contextual.source_sentence?.trim() ?? "";
      const selectionVerified = Boolean(selectedForm && selectedForm.includes(word) && context.includes(selectedForm));
      const sentenceVerified = Boolean(sourceSentence && context.includes(sourceSentence));
      if (!selectionVerified || !sentenceVerified) {
        parsed.contextual.selected_form = word;
        parsed.contextual.source_sentence = context;
        parsed.contextual.confidence = "low";
        parsed.contextual.needs_clarification = true;
        parsed.contextual.ambiguity_note = "The surrounding words do not confirm one safe meaning yet.";
      }
    }
    return Response.json(parsed);
  } catch (error) {
    console.error("Worksheet word-help route failed", error);
    return Response.json({ error: "This word clue is unavailable right now." }, { status: 500 });
  }
}
