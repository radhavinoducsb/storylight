import { getRuntimeEnv } from "../../../../runtime-env";

type Language = "ta" | "zh";
type Level = "P3" | "P5";

type ReadingSection = {
  id: string;
  title: string;
  text: string;
  currentPrompt: string;
};

type HomeworkItem = {
  label: string;
  printedMaterial: string;
  taskPrompt: string;
};

type Alignment = {
  section_id: string;
  prompt: string;
  thinking_goal: string;
  evidence_prompt: string;
  key_points: string[];
  preparation_for: string[];
};

function responseOutputText(payload: unknown) {
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
      level?: Level;
      readingSections?: ReadingSection[];
      homeworkItems?: HomeworkItem[];
    };
    if (!body.adultConfirmed) return Response.json({ error: "Adult confirmation is required." }, { status: 403 });
    if (!body.familyId?.trim() || !body.language || !body.level) return Response.json({ error: "Missing preparation details." }, { status: 400 });
    const readingSections = (body.readingSections ?? []).slice(0, 12);
    const homeworkItems = (body.homeworkItems ?? []).slice(0, 12);
    if (!readingSections.length || !homeworkItems.length) return Response.json({ error: "A story and its homework questions are required." }, { status: 400 });

    const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string }>();
    if (!runtime.OPENAI_API_KEY) return Response.json({ error: "Preparation alignment is unavailable." }, { status: 503 });
    const targetLanguage = body.language === "zh" ? "Mandarin Chinese" : "natural spoken Tamil";
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        sections: {
          type: "array",
          minItems: readingSections.length,
          maxItems: readingSections.length,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              section_id: { type: "string" },
              prompt: { type: "string" },
              thinking_goal: { type: "string" },
              evidence_prompt: { type: "string" },
              key_points: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } },
              preparation_for: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } },
            },
            required: ["section_id", "prompt", "thinking_goal", "evidence_prompt", "key_points", "preparation_for"],
          },
        },
      },
      required: ["sections"],
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.6",
        store: false,
        safety_identifier: body.familyId,
        reasoning: { effort: body.language === "ta" ? "medium" : "low" },
        instructions: `You design optional spoken preparation questions for a ${body.level} learner reading a school passage in ${targetLanguage}.

The printed homework items are authoritative and appear after the story. Replace the unrelated conversational question for each reading section with one short warm-up question that builds the exact evidence, vocabulary or reasoning needed for those later homework items.

Rules:
- Return exactly one alignment for every reading section, in the same order, and copy its section_id exactly.
- The warm-ups must form a useful progression: notice a concrete story detail, connect details to cause/feeling/main idea, then prepare the reasoning required by the printed homework.
- Every printed homework label must appear in preparation_for for at least one genuinely relevant reading section.
- A prompt must be answerable from that section's text. Never require facts from a later section.
- Write prompt in short, natural, child-friendly ${targetLanguage}. Use one direct question, not nested or translation-like wording.
- For Tamil, use idiomatic Singapore Primary classroom Tamil. Avoid literal English syntax, nested nominalisations and the calque “...என்ன காட்டுகிறது?”. Prefer direct forms such as “என்ன செய்தான்?”, “ஏன்?” or “கதையிலிருந்து ஒரு காரணம் சொல்.” when they fit. Check agreement, case markers, particles, punctuation and pronoun references.
- Keep one reasoning step in each prompt. Do not compress observation, inference and evidence into one long sentence.
- Do not copy a final homework question verbatim, reveal the correct option, state a model answer, or turn the warm-up into another worksheet.
- For a final multiple-choice question that also asks for reasons, prepare the child to notice and explain the supporting story evidence rather than rehearse an option label.
- thinking_goal and evidence_prompt are brief plain-English QA notes.
- key_points are private English criteria for checking the warm-up answer. Include only ideas supported by this reading section.
- Every reading section is one optional bonus-goal preparation question, so preparation_for must contain at least one exact homework label supplied below. Even an early setup paragraph should prepare a later item by drawing attention to a relevant character, setting, event or word. Never keep an unrelated conversational question when printed homework exists.
- The child may skip all warm-ups and answer the printed homework directly.`,
        input: JSON.stringify({ reading_sections: readingSections, printed_homework_items: homeworkItems }),
        text: { format: { type: "json_schema", name: "homework_preparation_alignment", strict: true, schema } },
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error("Homework preparation alignment failed", response.status, detail.slice(0, 500));
      return Response.json({ error: "The story warm-ups could not be connected to the homework yet." }, { status: 502 });
    }
    const raw = await response.json();
    const output = responseOutputText(raw);
    if (!output) return Response.json({ error: "No homework preparation was created." }, { status: 502 });
    const parsed = JSON.parse(output) as { sections?: Alignment[] };
    if (!Array.isArray(parsed.sections)) return Response.json({ error: "No usable homework preparation was created." }, { status: 502 });
    const requestedIds = readingSections.map((section) => section.id);
    const returnedIds = parsed.sections.map((section) => section.section_id);
    if (returnedIds.length !== requestedIds.length || requestedIds.some((id, index) => id !== returnedIds[index])) {
      return Response.json({ error: "The story warm-ups did not preserve the reading order." }, { status: 502 });
    }
    let alignedSections = parsed.sections;
    if (body.language === "ta") {
      const tamilPromptSchema = {
        type: "object",
        additionalProperties: false,
        properties: {
          sections: {
            type: "array",
            minItems: readingSections.length,
            maxItems: readingSections.length,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                section_id: { type: "string" },
                prompt: { type: "string" },
              },
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
          safety_identifier: body.familyId,
          reasoning: { effort: "medium" },
          instructions: `You are a senior Singapore primary-school Tamil editor. Review only the learner-facing Tamil warm-up prompt for each section.

Requirements:
- Preserve every section_id exactly and keep the same order.
- Keep the pedagogical purpose and printed-homework alignment of each draft question.
- Use natural, grammatically correct, age-appropriate Tamil—not Tamil that follows English syntax.
- Check word order, agreement, tense, case markers, particles, punctuation and unambiguous pronoun reference.
- Use one short, direct question with one reasoning step. Avoid nested clauses, abstract nominalisations and “...என்ன காட்டுகிறது?”.
- Prefer a concrete question about who, what, why or one story reason. Do not reveal a homework answer or introduce an idea not found in the supplied section.
- Return a polished prompt even if the draft is already acceptable. Return no English in prompt.`,
          input: JSON.stringify({
            reading_sections: readingSections,
            printed_homework_items: homeworkItems,
            draft_alignments: alignedSections.map((section) => ({ section_id: section.section_id, prompt: section.prompt, preparation_for: section.preparation_for })),
          }),
          text: { format: { type: "json_schema", name: "tamil_warmup_language_review", strict: true, schema: tamilPromptSchema } },
        }),
      });
      if (!tamilReview.ok) {
        const detail = await tamilReview.text();
        console.error("Tamil warm-up review failed", tamilReview.status, detail.slice(0, 500));
        return Response.json({ error: "The Tamil warm-ups did not pass the language check." }, { status: 502 });
      }
      const tamilOutput = responseOutputText(await tamilReview.json());
      const reviewed = tamilOutput ? JSON.parse(tamilOutput) as { sections?: Array<{ section_id: string; prompt: string }> } : null;
      const reviewedSections = reviewed?.sections;
      const reviewedIds = reviewedSections?.map((section) => section.section_id) ?? [];
      if (!reviewedSections || reviewedIds.length !== requestedIds.length || requestedIds.some((id, index) => id !== reviewedIds[index]) || reviewedSections.some((section) => !section.prompt.trim())) {
        return Response.json({ error: "The Tamil warm-ups did not pass the language check." }, { status: 502 });
      }
      const revisedPromptById = new Map(reviewedSections.map((section) => [section.section_id, section.prompt.trim()]));
      alignedSections = alignedSections.map((section) => ({ ...section, prompt: revisedPromptById.get(section.section_id) || section.prompt }));
    }
    const allowedLabels = new Set(homeworkItems.map((item) => item.label));
    const sections = alignedSections.map((section) => ({
      ...section,
      preparation_for: section.preparation_for.filter((label) => allowedLabels.has(label)),
    }));
    if (sections.some((section) => section.preparation_for.length === 0)) {
      return Response.json({ error: "Every story warm-up must prepare at least one homework question." }, { status: 502 });
    }
    const coveredLabels = new Set(sections.flatMap((section) => section.preparation_for));
    const missingLabels = homeworkItems.map((item) => item.label).filter((label) => !coveredLabels.has(label));
    if (missingLabels.length) {
      console.error("Homework preparation omitted printed items", missingLabels);
      return Response.json({ error: "Not every homework question received a story warm-up." }, { status: 502 });
    }
    return Response.json({ sections });
  } catch (error) {
    console.error("Homework preparation route failed", error);
    return Response.json({ error: "The story warm-ups could not be prepared." }, { status: 500 });
  }
}
