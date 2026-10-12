import { getRuntimeEnv } from "../../../../runtime-env";
import { responseOutputText } from "../../../../lib/openai-response";

type Payload = {
  adultConfirmed?: boolean;
  familyId?: string;
  title?: string;
  language?: "ta" | "zh";
  level?: "P3" | "P5";
  text?: string;
  worksheetQuestions?: string;
  previousContext?: string;
  batchLabel?: string;
  activityMode?: "auto" | "read_along" | "guided_exercise";
  visibleItemLabels?: string[];
  assessmentProfile?: { strengths?: string[]; focusAreas?: string[] } | null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Payload;
    if (!body.adultConfirmed) {
      return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
    }
    const sourceText = body.text?.trim() ?? "";
    const familyId = body.familyId?.trim() ?? "";
    if (!familyId || !body.language || !body.level || !sourceText) {
      return Response.json({ error: "Missing worksheet details." }, { status: 400 });
    }
    if (sourceText.length > 18_000) {
      return Response.json({ error: "Keep one worksheet passage under 18,000 characters." }, { status: 413 });
    }

    const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string }>();
    if (!runtime.OPENAI_API_KEY) {
      return Response.json({ error: "OpenAI worksheet preparation is not connected." }, { status: 503 });
    }

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        visual_bible: { type: "string" },
        content_kind: { type: "string", enum: ["story", "informational", "mixed", "exercise", "composition"] },
        learning_mode: { type: "string", enum: ["read_along", "guided_exercise", "composition_guide"] },
        sections: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              text: { type: "string" },
              section_kind: { type: "string", enum: ["reading", "exercise_item", "composition_stage"] },
              item_label: { type: "string" },
              illustration_prompt: { type: "string" },
              alt: { type: "string" },
              question: {
                type: "object",
                additionalProperties: false,
                properties: {
                  prompt: { type: "string" },
                  thinking_goal: { type: "string" },
                  evidence_prompt: { type: "string" },
                  key_points: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } },
                  response_mode: { type: "string", enum: ["spoken", "written"] },
                },
                required: ["prompt", "thinking_goal", "evidence_prompt", "key_points", "response_mode"],
              },
              support: {
                type: "object",
                additionalProperties: false,
                properties: {
                  goal: { type: "string" },
                  simple_explanation: { type: "string" },
                  hint_steps: { type: "array", minItems: 0, maxItems: 3, items: { type: "string" } },
                  answer_starter: { type: "string" },
                  self_check: { type: "array", minItems: 0, maxItems: 4, items: { type: "string" } },
                },
                required: ["goal", "simple_explanation", "hint_steps", "answer_starter", "self_check"],
              },
            },
            required: ["id", "title", "text", "section_kind", "item_label", "illustration_prompt", "alt", "question", "support"],
          },
        },
      },
      required: ["title", "visual_bible", "content_kind", "learning_mode", "sections"],
    };

    const targetLanguage = body.language === "ta" ? "Tamil" : "Mandarin Chinese";
    const activityMode = body.activityMode === "guided_exercise"
      ? "guided_exercise"
      : body.activityMode === "read_along"
        ? "read_along"
        : "auto";
    const visibleItemLabels = (body.visibleItemLabels ?? []).map((value) => value.trim()).filter(Boolean).slice(0, 12);
    const exerciseInstructions = `Set learning_mode to guided_exercise and content_kind to exercise. Create exactly one section for each printed exercise label in this order: ${visibleItemLabels.join(", ") || "the visible numbered items"}. Do not merge two questions into one section and do not invent comprehension questions.

For each section:
- section_kind is exercise_item and item_label is the exact printed label, such as Q1.
- text contains the complete printed material for only that item, including every source sentence, the required rewritten beginning, and visible blank. Preserve it exactly; do not solve or correct it.
- title is the item label. question.prompt is a short ${targetLanguage} invitation to complete that exact printed task, not a new question.
- question.response_mode is written for spelling, correction, fill-in-the-blank, multiple-choice, exact word forms or Mandarin-character tasks. It is spoken for open-ended comprehension or explanation; those answers may still be photographed later as optional written homework proof.
- support.goal is a short plain-English explanation of the transformation skill being practised.
- support.simple_explanation explains the meaning or relationship between the printed sentences in simple English without writing the transformed answer.
- support.hint_steps contains three progressively stronger, concise hints that make the learner construct the answer rather than guess it. For a spelling correction: first locate the doubtful letter or sound, then name a related base word or spelling rule, then show a partial word frame with the changing position blank. For grammar or transformation: first identify the relationship, then point to the grammar cue, then provide an incomplete structure. Do not provide multiple-choice answers or the completed response.
- support.answer_starter copies only the beginning explicitly printed by the worksheet for the learner to continue. If none is printed, use an empty string. Never complete it.
- support.self_check contains two or three plain-English checks the learner can apply after answering.
- question.key_points are private criteria for checking whether the learner preserved meaning, followed the printed beginning and used the needed grammatical relationship. They may contain the expected reasoning but must not be phrased as a model answer.
- illustration_prompt and alt are empty strings because exercise items do not need story illustrations.

Use the supplied worksheet instructions to understand the task, but keep them out of individual item text unless they are visibly repeated inside that item. Never reveal an answer key or generate a completed answer.`;
    const readAlongInstructions = `Set learning_mode to read_along. Split this confirmed batch at meaningful story events, changes of place, speaker or action—not at arbitrary word counts. Preserve every character of the confirmed source text exactly once, in the same order. Do not translate, simplify, correct, modernize, summarize or add story text. Each section must be substantial enough to feel like a real reading passage, generally 2–6 sentences. Use one section for a very short final page, otherwise use at least two and no more than eight.

For reading sections, section_kind is reading, item_label is empty, question.response_mode is spoken, and support.goal, support.simple_explanation, support.answer_starter, support.hint_steps and support.self_check are empty. Give each section a short title in ${targetLanguage}. Write illustration_prompt and alt in English. illustration_prompt must describe the exact moment in that section as a rich, imaginative, culturally respectful children's book scene without adding plot facts. visual_bible must consistently describe recurring characters, clothing, setting, palette and a luminous hand-painted gouache/watercolor style. Never request written words, labels, captions, speech bubbles, logos or UI inside illustrations.

Classify content_kind as story when the source has characters and a narrative sequence with an ending, informational when it explains facts or ideas without a plot, and mixed only when both are materially present. This controls whether an alternate-ending reward is pedagogically appropriate.

For every section, create one short spoken-understanding question in ${targetLanguage}. Vary the thinking: sequence, cause and effect, character feeling, evidence, prediction, main idea or a word in context. Make it appropriate for ${body.level}. The prompt must be answerable from that section and should invite explanation, not a one-word guess. thinking_goal and evidence_prompt must be short English notes for the QA interface. key_points are private coaching criteria in English, not model answers and never shown to the learner. Do not copy or reveal an answer key. If supplied worksheet questions are relevant, use them only to understand the skill emphasis; do not reproduce their answers.

${body.language === "ta" ? `Tamil question quality is non-negotiable. Use natural Singapore primary-school classroom Tamil, not a literal translation of an English reasoning prompt. Ask one direct, short question with one reasoning step. Avoid nested clauses, ambiguous pronouns, abstract nominalisations and “...என்ன காட்டுகிறது?”. Prefer concrete forms such as “என்ன செய்தான்?”, “ஏன்?” or “கதையிலிருந்து ஒரு காரணம் சொல்.” when appropriate. Silently check grammar, syntax, word order, agreement, case markers, particles and punctuation before returning each question.` : ""}`;
    const compositionInstructions = `Set learning_mode to composition_guide and content_kind to composition. This source is a textbook preparation guide for writing or continuing a composition; it is not a reading-comprehension passage and its planning prompts are not right-or-wrong quiz questions.

Convert the textbook guidance into an ordered composition path. Preserve the textbook's own logic and examples. Use composition_stage for every section and create only the stages supported by the confirmed source, normally: understand the given opening or situation; decide how to continue; develop the cause, habit or earlier event; build the main event; shape the climax or turning point; resolve the problem; and finish with the outcome, change or lesson. Do not invent a stage that the source does not support, and do not write the child's composition.

For each composition stage:
- title is a short ${targetLanguage} label for that planning stage.
- text contains the relevant textbook guidance or example from the confirmed source. Keep its meaning faithful; do not turn it into a model essay paragraph.
- question.prompt is one short, natural, child-friendly ${targetLanguage} prompt that helps the learner write their own idea or paragraph for this stage.
- question.response_mode is written.
- question.thinking_goal and question.evidence_prompt are concise English QA notes.
- question.key_points describe what a useful plan at this stage might contain, without prescribing one correct plot.
- support.goal and support.simple_explanation briefly explain the stage in plain English. support.hint_steps may contain up to three progressively useful planning cues grounded in the textbook. support.answer_starter and support.self_check stay empty.
- illustration_prompt and alt are empty. The learner's evolving illustration must be created later only from what the learner writes, never from an invented model answer.

If this is a continuation page of a composition guide, use preceding_batch_context_for_continuity_only to continue the same structure rather than reclassifying the page as a question worksheet.`;
    const activityInstructions = activityMode === "guided_exercise"
      ? `This is a structured school exercise, not a story or reading passage. ${exerciseInstructions}`
      : activityMode === "read_along"
        ? readAlongInstructions
        : `First classify the parent-confirmed text. Choose composition_guide when the page teaches how to understand, plan, continue, develop, climax or conclude a composition/essay—even if that guidance is presented as a table of questions and answers. A continuation page remains composition_guide when preceding context clearly belongs to the same composition lesson. Choose guided_exercise only when the page primarily asks the learner to answer, complete, rewrite, transform, match or choose among printed exercise items. Numbered paragraphs in a continuous narrative are story paragraphs, not exercise questions. Visible numeric labels alone are not evidence of an exercise.

If it is a composition preparation guide, follow these rules:
${compositionInstructions}

If it is an exercise, follow these rules:
${exerciseInstructions}

Otherwise follow these read-along rules:
${readAlongInstructions}`;
    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: body.language === "ta" ? "gpt-5.6" : "gpt-5.6-luna",
        store: false,
        safety_identifier: familyId,
        reasoning: { effort: body.language === "ta" ? "medium" : "low" },
        instructions: `You prepare an adult-only QA prototype for a future ${targetLanguage} ${body.level} learning activity.

${activityInstructions}

Confirmed learning profile from an earlier marked assessment: strengths=${(body.assessmentProfile?.strengths ?? []).slice(0, 4).join("; ") || "none saved"}; focus areas=${(body.assessmentProfile?.focusAreas ?? []).slice(0, 4).join("; ") || "none saved"}. Use this only to calibrate the amount and wording of support when it is relevant to the current printed task. Never change, replace or solve the worksheet because of the profile, and never force an unrelated focus area into the activity.`,
        input: JSON.stringify({
          supplied_title: body.title || "School worksheet",
          language: targetLanguage,
          level: body.level,
          confirmed_source_text: sourceText,
          preceding_batch_context_for_continuity_only: body.previousContext?.slice(-1200) || "",
          batch_label: body.batchLabel?.slice(0, 80) || "Current two-page batch",
          supplied_worksheet_questions: body.worksheetQuestions?.slice(0, 6000) || "",
          activity_mode: activityMode,
          visible_item_labels: visibleItemLabels,
        }),
        text: {
          format: {
            type: "json_schema",
            name: "worksheet_read_along",
            strict: true,
            schema,
          },
        },
      }),
    });

    if (!apiResponse.ok) {
      const detail = await apiResponse.text();
      console.error("Worksheet build failed", apiResponse.status, detail.slice(0, 500));
      return Response.json({ error: "The passage could not be divided into reading scenes." }, { status: 502 });
    }
    const raw = await apiResponse.json();
    const output = responseOutputText(raw);
    if (!output) return Response.json({ error: "No read-along was created." }, { status: 502 });
    const plan = JSON.parse(output) as {
      learning_mode?: string;
      content_kind?: string;
      sections?: Array<{
        id: string;
        title: string;
        text: string;
        section_kind: string;
        question: { prompt: string; [key: string]: unknown };
        [key: string]: unknown;
      }>;
      [key: string]: unknown;
    };
    if (activityMode === "guided_exercise" || (activityMode === "auto" && plan.learning_mode === "guided_exercise")) {
      const returnedLabels = (plan.sections ?? []).map((section) => typeof section.item_label==='string'?section.item_label.trim():undefined).filter(Boolean);
      const missingLabels = visibleItemLabels.filter((label) => !returnedLabels.includes(label));
      const itemBoundaryMismatch = visibleItemLabels.length > 0
        && (missingLabels.length > 0 || returnedLabels.length !== visibleItemLabels.length);
      if (plan.learning_mode !== "guided_exercise" || plan.content_kind !== "exercise" || itemBoundaryMismatch) {
        console.error("Guided exercise plan did not preserve item boundaries", { visibleItemLabels, returnedLabels });
        return Response.json({ error: "The exercise could not be separated safely into all of its printed questions. Please read this page again." }, { status: 502 });
      }
    }
    if (body.language === "ta" && plan.sections?.length) {
      const tamilQuestionSchema = {
        type: "object",
        additionalProperties: false,
        properties: {
          sections: {
            type: "array",
            minItems: plan.sections.length,
            maxItems: plan.sections.length,
            items: {
              type: "object",
              additionalProperties: false,
              properties: { section_id: { type: "string" }, prompt: { type: "string" } },
              required: ["section_id", "prompt"],
            },
          },
        },
        required: ["sections"],
      };
      const tamilReview = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { Authorization: `Bearer ${runtime.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.6",
          store: false,
          safety_identifier: familyId,
          reasoning: { effort: "medium" },
          instructions: `You are a senior Singapore primary-school Tamil editor. Polish only each learner-facing prompt.

- Preserve every section_id exactly and keep the same order.
- Preserve the task, story evidence and learning purpose. Do not add facts or reveal an answer.
- Use natural, grammatically correct, age-appropriate Tamil rather than English-shaped Tamil.
- Check word order, agreement, tense, case markers, particles, punctuation and pronoun reference.
- Use one short, direct question or instruction with one reasoning step. Avoid nested clauses, abstract nominalisations and “...என்ன காட்டுகிறது?”.
- For reading, ask concretely about who, what, why or one story reason. For exercises and composition, preserve the exact task type.
- Return no English in prompt.`,
          input: JSON.stringify({
            learning_mode: plan.learning_mode,
            sections: plan.sections.map((section) => ({ section_id: section.id, title: section.title, source_text: section.text, section_kind: section.section_kind, draft_prompt: section.question.prompt })),
          }),
          text: { format: { type: "json_schema", name: "tamil_question_language_review", strict: true, schema: tamilQuestionSchema } },
        }),
      });
      if (!tamilReview.ok) {
        const detail = await tamilReview.text();
        console.error("Tamil question review failed", tamilReview.status, detail.slice(0, 500));
        return Response.json({ error: "The learner questions did not pass the Tamil language check." }, { status: 502 });
      }
      const tamilOutput = responseOutputText(await tamilReview.json());
      const reviewed = tamilOutput ? JSON.parse(tamilOutput) as { sections?: Array<{ section_id: string; prompt: string }> } : null;
      const reviewedSections = reviewed?.sections;
      const requestedIds = plan.sections.map((section) => section.id);
      const reviewedIds = reviewedSections?.map((section) => section.section_id) ?? [];
      if (!reviewedSections || reviewedIds.length !== requestedIds.length || requestedIds.some((id, index) => id !== reviewedIds[index]) || reviewedSections.some((section) => !section.prompt.trim())) {
        return Response.json({ error: "The learner questions did not pass the Tamil language check." }, { status: 502 });
      }
      const revisedPromptById = new Map(reviewedSections.map((section) => [section.section_id, section.prompt.trim()]));
      plan.sections = plan.sections.map((section) => ({
        ...section,
        question: { ...section.question, prompt: revisedPromptById.get(section.id) || section.question.prompt },
      }));
    }
    return Response.json({
      ...plan,
      worksheetId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      language: body.language,
      level: body.level,
    });
  } catch (error) {
    console.error("Worksheet build route failed", error);
    return Response.json({ error: "The illustrated reader could not be prepared." }, { status: 500 });
  }
}
