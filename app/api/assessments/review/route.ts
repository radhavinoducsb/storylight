import { getRuntimeEnv } from "../../../../runtime-env";
import { responseOutputText } from "../../../../lib/openai-response";

type ConfirmedPage = { textAccepted?: boolean; roleAccepted?: boolean; role?: string; transcript?: string; score_summary?: string; visible_teacher_feedback?: string[] };

export async function POST(request: Request) {
  try {
    const body = await request.json() as { adultConfirmed?: boolean; familyId?: string; language?: "ta" | "zh"; level?: "P3" | "P5"; pages?: ConfirmedPage[] };
    if (!body.adultConfirmed) return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
    if(!body.pages?.length||body.pages.some(page=>page.textAccepted!==true||page.roleAccepted!==true||!!(page as {ocrFailure?:string}).ocrFailure))return Response.json({error:'Confirm the extracted text and document roles before reviewing marked work.'},{status:400});
    const familyId = body.familyId?.trim() ?? "";
    const pages = (body.pages ?? []).slice(0, 20).map((page) => ({ role: page.role || "other", transcript: page.transcript?.slice(0, 12_000) || "", score_summary: page.score_summary?.slice(0, 500) || "", visible_teacher_feedback: (page.visible_teacher_feedback ?? []).slice(0, 20) }));
    if (!familyId || !pages.some((page) => page.role === "student_answer") || !pages.some((page) => page.role === "printed_prompt")) return Response.json({ error: "A confirmed prompt and learner answer are required." }, { status: 400 });
    const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string }>();
    if (!runtime.OPENAI_API_KEY) return Response.json({ error: "OpenAI assessment review is not connected." }, { status: 503 });
    const targetLanguage = body.language === "zh" ? "Mandarin Chinese" : "Tamil";
    const sceneSchema = {
      type: "object", additionalProperties: false,
      properties: { prompt: { type: "string" }, alt: { type: "string" } },
      required: ["prompt", "alt"],
    };
    const schema = {
      type: "object", additionalProperties: false,
      properties: {
        title: { type: "string" },
        overall_summary: { type: "string" },
        strengths: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } },
        focus_areas: { type: "array", minItems: 1, maxItems: 4, items: { type: "string" } },
        rubric: { type: "array", minItems: 1, maxItems: 6, items: { type: "object", additionalProperties: false, properties: { category: { type: "string" }, observed: { type: "string" }, next_step: { type: "string" } }, required: ["category", "observed", "next_step"] } },
        next_practice: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, instruction: { type: "string" } }, required: ["title", "instruction"] },
        voice_teacher_prompt: { type: "string" },
        illustrations: {
          type: "object", additionalProperties: false,
          properties: { visual_bible: { type: "string" }, strength: sceneSchema, focus: sceneSchema, practice: sceneSchema },
          required: ["visual_bible", "strength", "focus", "practice"],
        },
      },
      required: ["title", "overall_summary", "strengths", "focus_areas", "rubric", "next_practice", "voice_teacher_prompt", "illustrations"],
    };
    const instructions = `You review already marked ${targetLanguage} ${body.level === "P5" ? "Primary 5" : "Primary 3"} assessment work for a parent-facing QA prototype. Use only the adult-confirmed document roles. Never treat model_answer as the learner's work. The teacher's marks, corrections, rubric and feedback outrank your own inference. Do not regrade or invent a score.\n\nIdentify specific strengths demonstrated in student_answer and specific focus areas supported by teacher_annotations or rubric_feedback. Make the next practice small and actionable. Avoid generic advice such as “practise more.” The Voice Teacher prompt must help the learner understand one improvement without giving a full model answer.\n\nThe learner sees three small cards: strengths[0], then focus_areas[0], then next_practice.instruction. Put the most useful demonstrated strength first. Put the single highest-priority, achievable improvement first, and make next_practice and voice_teacher_prompt practise precisely that same improvement. Each strength and focus area must be ONE short, kind, concrete sentence addressed to the learner. Use at most 45 Chinese characters or 18 Tamil words per item; prefer fewer. next_practice.instruction is ONE tiny action, at most 60 Chinese characters or 24 Tamil words, with at most one short question. Avoid bundling multiple corrections in a sentence. Do not provide the completed answer. Keep overall_summary to two short sentences. Keep each rubric observed and next_step to one sentence; supporting teacher evidence belongs here, not in the learner cards. Titles should be brief. Retain all distinct supported focus areas in the adult report. The voice_teacher_prompt asks one short question about the same practice task and waits.\n\nPlan one contextual illustration for each child card in illustrations: strength supports strengths[0], focus supports focus_areas[0], and practice supports next_practice.instruction. Write each prompt and alt in plain English. Each prompt depicts a simple, concrete story moment or object grounded ONLY in the confirmed printed prompt and learner work, with no invented plot events, additional mistakes, completed model answer, written words or personal identifiers. Keep pictures kind and encouraging, never mocking or marking the child as a failure. For sentence clarity, show the actual character doing the actual action discussed; for sequence, show the relevant story moment. If the source is abstract, use only the concrete objects actually named in it, not an unrelated mascot or fantasy scene. Alt text must describe the picture briefly without revealing an answer. visual_bible describes consistent fictional character clothing, objects, setting and a clean friendly storybook style across all three scenes. Do not claim an illustration is an original assessment image.\n\nWrite all child-facing summaries, strengths, focus areas, rubric explanations, next practice and Voice Teacher prompt in natural, age-appropriate ${targetLanguage}. Language correctness is paramount. ${body.language === "ta" ? "Use idiomatic Singapore primary-school Tamil; silently check syntax, agreement, case markers, pronouns and word order. Avoid translated English constructions and abstract wording." : "Use simple, idiomatic Simplified Chinese appropriate for a Singapore primary learner; silently check word order, classifiers, particles and punctuation."}`;
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.6", store: false, safety_identifier: familyId, reasoning: { effort: "high" }, instructions, input: JSON.stringify(pages), text: { format: { type: "json_schema", name: "confirmed_assessment_review", strict: true, schema } } }),
    });
    if (!upstream.ok) {
      console.error("Assessment review failed", upstream.status, (await upstream.text()).slice(0, 500));
      return Response.json({ error: "The marked work could not be reviewed." }, { status: 502 });
    }
    const output = responseOutputText(await upstream.json());
    if (!output) return Response.json({ error: "No assessment review was returned." }, { status: 502 });
    return Response.json(JSON.parse(output));
  } catch (error) {
    console.error("Assessment review route failed", error);
    return Response.json({ error: "The marked work could not be reviewed." }, { status: 500 });
  }
}
