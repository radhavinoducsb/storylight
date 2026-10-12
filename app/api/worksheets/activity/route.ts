import { getRuntimeEnv } from "../../../../runtime-env";
import { responseOutputText } from "../../../../lib/openai-response";

type Payload = {
  adultConfirmed?: boolean;
  language?: "ta" | "zh";
  level?: "P3" | "P5";
  itemLabel?: string;
  sourceText?: string;
  questionPrompt?: string;
  goal?: string;
  keyPoints?: string[];
};

export async function POST(request: Request) {
  const body = await request.json() as Payload;
  if (!body.adultConfirmed) return Response.json({ error: "Adult confirmation is required." }, { status: 403 });
  if (!body.sourceText?.trim() || !body.questionPrompt?.trim()) return Response.json({ error: "Worksheet text and question are required." }, { status: 400 });

  const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string }>();
  if (!runtime.OPENAI_API_KEY) return Response.json({ error: "Worksheet activity preparation is not connected." }, { status: 503 });

  const targetLanguage = body.language === "zh" ? "Mandarin Chinese" : "Tamil";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${runtime.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-luna",
      store: false,
      reasoning: { effort: "medium" },
      instructions: `Create a short, specific reasoning scaffold for one verified ${targetLanguage} primary-school worksheet item. The scaffold must help the learner construct the answer; it must not offer multiple-choice guesses and must not repeat generic advice.

The worksheet is authoritative. Do not create a new question or change its wording. Return scaffold_available true whenever a useful item-specific scaffold can be made.

For a spelling or one-word correction:
- activity_kind is word_correction and focus_text is the exact incorrect marked word.
- clue_one gives one concrete related base word, word-family example or spelling pattern that genuinely helps. For example, if the correction depends on the family word துல்லியம், show that exact related word. Do not merely say “read it aloud” or “think of the correct spelling.”
- clue_two identifies the exact letter, sound or word-family relationship the learner should notice without writing the completed corrected word.
- construction_frame shows the corrected word structure with the essential changed grapheme or short chunk replaced by a visible blank, such as துல்லி _ மாக. It must never contain the completed answer.

For grammar, sentence transformation or comprehension, make the same three fields equally concrete: cite the exact grammar cue or source phrase, explain the specific relationship, and provide an incomplete construction frame. Keep each clue under 24 words. Never use generic self-checks.

Legacy fields must remain empty except is_word_substitution, which is true only for a one-word correction. options must always be an empty array; never produce answer choices, a correct answer or a corrected sentence.`,
      input: JSON.stringify({
        item_label: body.itemLabel ?? "",
        level: body.level ?? "P5",
        printed_source_text: body.sourceText.slice(0, 4000),
        printed_question: body.questionPrompt.slice(0, 1000),
        curriculum_goal: body.goal?.slice(0, 800) ?? "",
        private_checking_criteria: (body.keyPoints ?? []).slice(0, 4),
      }),
      text: { format: { type: "json_schema", name: "worksheet_word_substitution", strict: true, schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          scaffold_available: { type: "boolean" },
          activity_kind: { type: "string", enum: ["word_correction", "sentence_transformation", "comprehension", "other"] },
          focus_text: { type: "string" },
          clue_one: { type: "string" },
          clue_two: { type: "string" },
          construction_frame: { type: "string" },
          is_word_substitution: { type: "boolean" },
          worksheet_skill_english: { type: "string" },
          instruction_target: { type: "string" },
          source_sentence: { type: "string" },
          target_word: { type: "string" },
          options: { type: "array", minItems: 0, maxItems: 0, items: { type: "string" } },
          correct_word: { type: "string" },
          corrected_sentence: { type: "string" },
          short_reason_english: { type: "string" },
        },
        required: ["scaffold_available", "activity_kind", "focus_text", "clue_one", "clue_two", "construction_frame", "is_word_substitution", "worksheet_skill_english", "instruction_target", "source_sentence", "target_word", "options", "correct_word", "corrected_sentence", "short_reason_english"],
      } } },
    }),
  });

  const data = await response.json();
  const output = responseOutputText(data);
  if (!response.ok || !output) return Response.json({ error: "The worksheet activity could not be prepared." }, { status: 502 });
  const activity = JSON.parse(output) as {
    scaffold_available?: boolean;
    focus_text?: string;
    clue_one?: string;
    clue_two?: string;
    construction_frame?: string;
    is_word_substitution?: boolean;
    source_sentence?: string;
    target_word?: string;
    options?: string[];
    correct_word?: string;
    corrected_sentence?: string;
  };
  const valid = Boolean(activity.scaffold_available && activity.focus_text && activity.clue_one && activity.clue_two && activity.construction_frame && activity.options?.length === 0);
  if (!valid) return Response.json({ error: "A specific worksheet scaffold could not be prepared." }, { status: 502 });
  return Response.json(activity);
}
