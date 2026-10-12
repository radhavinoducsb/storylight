import { getRuntimeEnv } from "../../../../runtime-env";
import { bytesToDataUrl, responseOutputText } from "../../../../lib/openai-response";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

type HandwritingResult = {
  task_type: "open_ended" | "objective_writing";
  readability: "readable" | "uncertain" | "unreadable";
  transcription: string;
  verdict: "correct" | "partly_correct" | "incorrect" | "unreadable";
  accepted_for_progress: boolean;
  feedback: string;
  parent_note: string;
  key_points_covered: number;
  key_points_total: number;
};

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    if (form.get("adultConfirmed") !== "true") {
      return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
    }
    const familyId = String(form.get("familyId") || "").trim();
    const language = form.get("language") === "zh" ? "zh" : form.get("language") === "ta" ? "ta" : "";
    const level = form.get("level") === "P5" ? "P5" : form.get("level") === "P3" ? "P3" : "";
    const image = form.get("image");
    if (!familyId || !language || !level || !(image instanceof File) || !image.size) {
      return Response.json({ error: "The written answer photo is incomplete." }, { status: 400 });
    }
    if (!ACCEPTED_TYPES.has(image.type)) {
      return Response.json({ error: "Use a JPG, PNG or WEBP photo." }, { status: 400 });
    }
    if (image.size > 8 * 1024 * 1024) {
      return Response.json({ error: "This photo is over 8 MB. Crop it to the answer and try again." }, { status: 413 });
    }

    const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string }>();
    if (!runtime.OPENAI_API_KEY) {
      return Response.json({ error: "Written-answer checking is not connected." }, { status: 503 });
    }

    const worksheetTitle = String(form.get("worksheetTitle") || "Worksheet").slice(0, 300);
    const sourceText = String(form.get("sourceText") || "").slice(0, 8_000);
    const question = String(form.get("question") || "").slice(0, 1_500);
    const expectedTask = form.get("expectedTask") === "objective_writing" ? "objective_writing" : "open_ended";
    let keyPoints: string[] = [];
    try {
      const parsed = JSON.parse(String(form.get("keyPoints") || "[]"));
      if (Array.isArray(parsed)) keyPoints = parsed.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 6);
    } catch {
      keyPoints = [];
    }
    const keyPointTotal = Math.max(1, keyPoints.length || 1);
    const targetLanguage = language === "ta" ? "Tamil" : "Mandarin Chinese";
    const imageUrl = await bytesToDataUrl(image);

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        task_type: { type: "string", enum: ["open_ended", "objective_writing"] },
        readability: { type: "string", enum: ["readable", "uncertain", "unreadable"] },
        transcription: { type: "string" },
        verdict: { type: "string", enum: ["correct", "partly_correct", "incorrect", "unreadable"] },
        accepted_for_progress: { type: "boolean" },
        feedback: { type: "string" },
        parent_note: { type: "string" },
        key_points_covered: { type: "integer", minimum: 0, maximum: keyPointTotal },
        key_points_total: { type: "integer", enum: [keyPointTotal] },
      },
      required: ["task_type", "readability", "transcription", "verdict", "accepted_for_progress", "feedback", "parent_note", "key_points_covered", "key_points_total"],
    };

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6",
        store: false,
        safety_identifier: familyId,
        reasoning: { effort: expectedTask === "objective_writing" ? "low" : "medium" },
        instructions: `You check one photographed ${targetLanguage} answer in an adult-only Primary ${level === "P5" ? "5" : "3"} language-learning prototype.

Read only the learner's answer. Ignore handwriting beauty. Never infer a missing answer from the printed question, surrounding page or private criteria.

Readability comes first:
- If the answer is cropped, blurred, too faint, obscured, or you are not confident about the relevant letters/characters, use verdict unreadable, accepted_for_progress false and key_points_covered 0. Do not judge correctness and do not guess a transcription.
- Use readability uncertain only when most text is readable but one decisive form is doubtful; its verdict must still be unreadable.

Task rules:
- expected_task is ${expectedTask}. Keep task_type equal to it.
- objective_writing covers spelling correction, fill-in-the-blank, exact word or character forms and short choices. It is correct only when the required written ${targetLanguage} form is correct. Use only correct, incorrect or unreadable—never partly_correct.
- open_ended covers comprehension or explanation. Judge whether the answer addresses the question, uses source-supported meaning and is understandable. Accept age-appropriate language even when one minor grammar error remains. Use partly_correct when a relevant idea is present but an essential idea is missing.
- For Mandarin, distinguish a correct intended word from a wrong written character. For Tamil, check standard school spelling, syntax, agreement, case markers and word order.

Learner feedback must be one natural, grammatically correct ${targetLanguage} sentence of at most 14 words. Mention only the next useful step. Do not translate an English coaching template, reveal a completed answer, quote the private criteria, or use English. For an unreadable photo, simply ask for a clearer photo in ${targetLanguage}.

parent_note is a concise English QA explanation. accepted_for_progress is true only for verdict correct. key_points_total is exactly ${keyPointTotal}.`,
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                worksheet_title: worksheetTitle,
                source_passage_or_item: sourceText,
                learner_question: question,
                expected_task: expectedTask,
                private_checking_points: keyPoints,
              }),
            },
            { type: "input_image", image_url: imageUrl, detail: "high" },
          ],
        }],
        text: { format: { type: "json_schema", name: "handwritten_homework_check", strict: true, schema } },
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      console.error("Handwriting check failed", response.status, detail.slice(0, 500));
      return Response.json({ error: "The written answer could not be checked." }, { status: 502 });
    }
    const output = responseOutputText(await response.json());
    if (!output) return Response.json({ error: "The written answer could not be read." }, { status: 502 });
    const result = JSON.parse(output) as HandwritingResult;
    if (result.task_type !== expectedTask || result.key_points_total !== keyPointTotal) {
      return Response.json({ error: "The written answer check was incomplete." }, { status: 502 });
    }
    if (result.readability !== "readable" || result.verdict === "unreadable") {
      result.verdict = "unreadable";
      result.accepted_for_progress = false;
      result.key_points_covered = 0;
      result.transcription = "";
    } else if (expectedTask === "objective_writing" && result.verdict === "partly_correct") {
      result.verdict = "incorrect";
      result.accepted_for_progress = false;
    } else if (result.verdict === "correct" && result.key_points_covered < keyPointTotal) {
      result.verdict = expectedTask === "objective_writing" ? "incorrect" : "partly_correct";
      result.accepted_for_progress = false;
    } else {
      result.accepted_for_progress = result.verdict === "correct";
    }
    return Response.json(result);
  } catch (error) {
    console.error("Handwriting route failed", error);
    return Response.json({ error: "The written answer could not be checked." }, { status: 500 });
  }
}
