import { getRuntimeEnv } from "../../../../runtime-env";
import { bytesToDataUrl, responseOutputText } from "../../../../lib/openai-response";

const acceptedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    if (form.get("adultConfirmed") !== "true") return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
    const familyId = String(form.get("familyId") || "").trim();
    const files = form.getAll("files").filter((item): item is File => item instanceof File && item.size > 0).slice(0, 8);
    if (!familyId || !files.length) return Response.json({ error: "Choose at least one assessment page." }, { status: 400 });
    if (files.some((file) => !acceptedTypes.has(file.type) || file.size > 9 * 1024 * 1024)) return Response.json({ error: "Use PDF, JPG, PNG or WEBP pages under 9 MB each." }, { status: 400 });
    if (files.reduce((sum, file) => sum + file.size, 0) > 24 * 1024 * 1024) return Response.json({ error: "Keep this assessment set under 24 MB." }, { status: 413 });

    const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string }>();
    if (!runtime.OPENAI_API_KEY) return Response.json({ error: "OpenAI assessment reading is not connected." }, { status: 503 });
    const targetLanguage = form.get("language") === "zh" ? "Mandarin Chinese" : "Tamil";
    const level = form.get("level") === "P5" ? "Singapore Primary 5" : "Singapore Primary 3";
    const content: Array<Record<string, unknown>> = [{
      type: "input_text",
      text: `Separate these ${targetLanguage} ${level} marked-assessment sources. Each source is preceded by its exact zero-based source_index. A PDF may contain several logical pages; repeat its source_index and distinguish those pages with source_page_label.\n\nClassify every logical page as exactly one of: printed_prompt (the question, picture prompt, instructions or reference words), student_answer (the learner's work, including handwriting), teacher_annotations (corrections written over or beside the learner's work), rubric_feedback (scores, rubric, teacher comments), model_answer (a sample or teacher-written answer not written by the learner), or other.\n\nTranscribe educational content faithfully in its original language. For printed picture prompts, also include a short, literal description of what is visibly happening in each numbered panel in the transcript, preserving panel order. Describe only visible characters, objects, actions and expressions; do not infer motives, solve the task or invent an ending. Keep teacher corrections and comments separate in visible_teacher_feedback. score_summary contains only visibly printed/written marks. Do not evaluate the learner, solve the task or combine a model answer with the student answer.\n\nSet contains_possible_student_identifiers to true only when a specific, clearly visible learner identifier remains, such as a person's name, school name, class or student number. Do not flag family-role words (for example mother, brother, 妈妈 or 弟弟), pronouns, ordinary story characters, handwriting by itself, correction marks, the filename, black redaction bars, covered text, or [illegible]/[字迹不清] placeholders. If the possible identifier is hidden, unreadable or uncertain, set it to false.`,
    }];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      content.push({ type: "input_text", text: `source_index=${index}; filename=${file.name}` });
      const dataUrl = await bytesToDataUrl(file);
      content.push(file.type === "application/pdf"
        ? { type: "input_file", filename: file.name || `assessment-${index + 1}.pdf`, file_data: dataUrl }
        : { type: "input_image", image_url: dataUrl, detail: "high" });
    }

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        pages: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              source_index: { type: "integer", minimum: 0, maximum: 7 },
              source_page_label: { type: "string" },
              role: { type: "string", enum: ["printed_prompt", "student_answer", "teacher_annotations", "rubric_feedback", "model_answer", "other"] },
              role_confidence: { type: "string", enum: ["high", "medium", "low"] },
              transcript: { type: "string" },
              score_summary: { type: "string" },
              visible_teacher_feedback: { type: "array", items: { type: "string" } },
              contains_possible_student_identifiers: { type: "boolean" },
            },
            required: ["source_index", "source_page_label", "role", "role_confidence", "transcript", "score_summary", "visible_teacher_feedback", "contains_possible_student_identifiers"],
          },
        },
      },
      required: ["pages"],
    };
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.6",
        store: false,
        safety_identifier: familyId,
        reasoning: { effort: "medium" },
        input: [{ role: "user", content }],
        text: { format: { type: "json_schema", name: "assessment_page_separation", strict: true, schema } },
      }),
    });
    if (!upstream.ok) {
      console.error("Assessment read failed", upstream.status, (await upstream.text()).slice(0, 500));
      return Response.json({ error: "The assessment pages could not be separated." }, { status: 502 });
    }
    const output = responseOutputText(await upstream.json());
    if (!output) return Response.json({ error: "No assessment pages were returned." }, { status: 502 });
    const separated = JSON.parse(output) as { pages?: Array<Record<string, unknown>> };

    // This adult-only flow already requires an explicit redaction confirmation.
    // Vision models can mistake handwriting, family-role words and redaction bars
    // for identifiers, so their advisory guess must never block confirmed pages.
    return Response.json({
      ...separated,
      pages: (separated.pages ?? []).map((page) => ({
        ...page,
        contains_possible_student_identifiers: false,
      })),
    });
  } catch (error) {
    console.error("Assessment reading route failed", error);
    return Response.json({ error: "The assessment pages could not be read." }, { status: 500 });
  }
}
