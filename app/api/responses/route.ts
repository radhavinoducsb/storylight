import { desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { storyResponses } from "../../../db/schema";
import { ensureStoryResponsesSchema } from "../../../db/story-responses";
import { getRuntimeEnv } from "../../../runtime-env";

type Language = "ta" | "zh";
type Level = "P3" | "P5";

type Feedback = {
  usable: boolean;
  language_status: "target_language" | "mostly_target_language" | "mixed" | "wrong_language" | "gibberish";
  accepted_for_progress: boolean;
  relevance: "relevant" | "partly_relevant" | "not_relevant" | "not_checked";
  grammar_status: "clear" | "small_fix" | "needs_retry" | "not_checked";
  encouragement: string;
  corrected_response: string;
  parent_note: string;
  retry_prompt: string;
  used_words: string[];
  verdict: "correct" | "partly_correct" | "incorrect" | "not_checked";
  reference_answer: string;
  story_evidence: string;
  key_points_covered: number;
  key_points_total: number;
  word_evidence: Array<{
    target_word: string;
    used: boolean;
    meaningful_use: boolean;
    matched_form: string;
    reason: string;
  }>;
  should_retry: boolean;
};

type ResponsePayload = {
  adultConfirmed?: boolean;
  familyId?: string;
  storyTitle?: string;
  beatId?: string;
  language?: Language;
  level?: Level;
  kind?: "question" | "ending";
  prompt?: string;
  storyContext?: string;
  transcript?: string;
  targetWords?: string[];
  attempt?: number;
  answerPolicy?: "language" | "guided_reasoning";
  keyPoints?: string[];
};

function responseText(payload: unknown) {
  const value = payload as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  return (value.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text)
    .join("");
}

function pendingFeedback(transcript: string, language: Language, targetWords: string[]): Feedback {
  const usedWords = targetWords.filter((word) => transcript.includes(word));
  return {
    usable: transcript.trim().length > 0,
    language_status: "target_language",
    accepted_for_progress: false,
    relevance: "not_checked",
    grammar_status: "not_checked",
    encouragement: language === "ta" ? "உங்கள் பதில் பாதுகாப்பாகச் சேமிக்கப்பட்டது." : "你的回答已经保存。",
    corrected_response: transcript,
    parent_note: "Saved exactly as spoken. The language coach is not connected yet, so no grammar or relevance judgement was invented.",
    retry_prompt: "",
    used_words: usedWords,
    verdict: "not_checked",
    reference_answer: "",
    story_evidence: "",
    key_points_covered: 0,
    key_points_total: 0,
    word_evidence: targetWords.map((word) => ({
      target_word: word,
      used: transcript.includes(word),
      meaningful_use: transcript.includes(word),
      matched_form: transcript.includes(word) ? word : "",
      reason: "The AI checker is not connected, so this is only an exact text match.",
    })),
    should_retry: false,
  };
}

async function evaluateWithAgent(payload: Required<ResponsePayload>, apiKey: string): Promise<Feedback> {
  const targetLanguage = payload.language === "ta" ? "Tamil" : "Mandarin Chinese";
  const ageBand = payload.level === "P3" ? "Singapore Primary 3" : "Singapore Primary 5";
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      usable: { type: "boolean" },
      language_status: { type: "string", enum: ["target_language", "mostly_target_language", "mixed", "wrong_language", "gibberish"] },
      accepted_for_progress: { type: "boolean" },
      relevance: { type: "string", enum: ["relevant", "partly_relevant", "not_relevant"] },
      grammar_status: { type: "string", enum: ["clear", "small_fix", "needs_retry"] },
      encouragement: { type: "string" },
      corrected_response: { type: "string" },
      parent_note: { type: "string" },
      retry_prompt: { type: "string" },
      used_words: { type: "array", items: { type: "string" } },
      verdict: { type: "string", enum: ["correct", "partly_correct", "incorrect"] },
      reference_answer: { type: "string" },
      story_evidence: { type: "string" },
      key_points_covered: { type: "integer", minimum: 0 },
      key_points_total: { type: "integer", minimum: 0 },
      word_evidence: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            target_word: { type: "string" },
            used: { type: "boolean" },
            meaningful_use: { type: "boolean" },
            matched_form: { type: "string" },
            reason: { type: "string" },
          },
          required: ["target_word", "used", "meaningful_use", "matched_form", "reason"],
        },
      },
      should_retry: { type: "boolean" },
    },
    required: [
      "usable",
      "language_status",
      "accepted_for_progress",
      "relevance",
      "grammar_status",
      "encouragement",
      "corrected_response",
      "parent_note",
      "retry_prompt",
      "used_words",
      "verdict",
      "reference_answer",
      "story_evidence",
      "key_points_covered",
      "key_points_total",
      "word_evidence",
      "should_retry",
    ],
  };

  const guidedReasoning = payload.answerPolicy === "guided_reasoning";
  const instruction = `You are a gentle ${targetLanguage} oral-language coach inside an adult-only QA prototype.
The speaker is an adult tester simulating a learner response at ${ageBand} level. Evaluate the transcribed answer against the exact question and story context. Do not infer that the speaker is a child.

Rules:
- First decide whether the transcript is usable speech. Reject empty, repeated nonsense, invented sounds, random words, or unrelated gibberish; never reward length.
- Classify language_status strictly. target_language means fully ${targetLanguage}; mostly_target_language allows only an occasional borrowed or English word; mixed means substantial switching; wrong_language means the answer is predominantly English or another language; gibberish means it has no coherent interpretable meaning.
- accepted_for_progress is false for wrong_language, gibberish, mixed-language answers that do not contain a meaningful ${targetLanguage} sentence, an unevidenced or incomplete worksheet answer, or an irrelevant response.
- Do not accept an English answer merely because its idea is relevant. This activity practises speaking ${targetLanguage}.
- Judge relevance by meaning, not by matching one expected sentence. A creative ending may be plausible without matching the traditional tale.
- Correct only grammatical mistakes that materially improve clarity. Preserve the tester's idea, vocabulary, and voice. Do not rewrite it into literary language.
- For P3, make at most one small correction. For P5, make at most two.
- Accept natural spoken language. Do not penalise punctuation because this began as speech.
- If the tester uses one missing English word inside an otherwise meaningful ${targetLanguage} sentence, preserve the idea and invite that one phrase in ${targetLanguage}; do not shame them.
- For wrong_language, mixed, or gibberish, encouragement and retry_prompt may use very simple English plus a generic ${targetLanguage} speaking starter. Never include the answer. Otherwise, keep them short and in ${targetLanguage}.
- Write learner-facing ${targetLanguage} as a primary-school teacher would naturally speak. Never translate English coaching phrases literally, use literary language, or stack several clauses into one sentence.
- parent_note is always one plain-English audit sentence for the adult QA journal. It is never learner-facing feedback.
- corrected_response must be in ${targetLanguage}. If no correction is needed, repeat the transcript exactly.
- Return a direct verdict: correct when the answer is supported and sufficiently answers the question, partly_correct when it contains a useful but incomplete or partly unsupported idea, and incorrect when it does not answer the question. Be clear rather than euphemistic.
- reference_answer must be one concise acceptable answer in ${targetLanguage}, grounded only in the supplied story context. It is a comparison example, not the only possible wording. For a creative ending, give one plausible example and do not call alternatives wrong.
- story_evidence must be the shortest exact clause or sentence from the supplied story context that supports the reference answer. Do not invent or paraphrase evidence.
- key_points_total and key_points_covered are 0 outside guided worksheet mode.
- Return exactly one word_evidence item for every supplied target word, in the same order. Detect natural inflections, attached particles, case endings, and speech-transcription variants—not only exact base-form substrings. used is true when a recognizable form occurs. meaningful_use is true only when that form contributes coherently to the sentence. matched_form is the actual form in the transcript, or an empty string. reason is one short plain-English audit note.
- used_words may contain only exact items from the supplied target-word list whose word_evidence meaningful_use is true. Never award a word merely because the characters appear inside an unrelated word.
- should_retry is true only for unusable, not relevant, or meaning-blocking language. A small fix does not require a retry.
- accepted_for_progress may be true only when should_retry is false, relevance is relevant, and the learner has given a meaningful answer mainly in ${targetLanguage}.
- Do not give a score, band, rank, diagnosis, or overall ability label.`;

  const reasoningInstruction = guidedReasoning ? `
This is a guided worksheet-thinking turn. The supplied key points are private coaching criteria, never an answer to display.
- Never state the correct answer, reveal a multiple-choice option, quote a missing key point, or complete the answer for the tester.
- Decide whether the response has addressed the question and covered the relevant ideas in the private key-point list.
- key_points_total must equal the number of supplied private key points. key_points_covered is the number that the learner has meaningfully connected in this response. Do not award a point for merely repeating a word.
- encouragement must be one natural child-friendly sentence in ${targetLanguage}, no more than 6 words. Do not explain the mistake here.
- parent_note must remain one plain-English audit sentence for the adult QA journal. Do not put learner coaching in this field.
- If the answer needs another attempt, retry_prompt must be the only learner-facing clue: one direct, natural sentence in ${targetLanguage}, no more than 12 words, containing only one idea. Prefer a simple instruction over an abstract or nested question.
- For a spelling or word-form task, point to the marked word and give one concrete sound, letter, root-word, or word-family clue. Do not ask broad questions such as how the word must "change" or "fit the action".
- For Tamil, use everyday classroom Tamil suitable for a Singapore Primary 5 learner. Avoid translation-like phrases such as “என்று சிந்தியுங்கள்”, “வகையில் எப்படி மாற வேண்டும்”, and indirect questions inside questions.
- Before returning Tamil encouragement or retry_prompt, silently check word order, agreement, tense, case markers, particles and pronoun reference. Rewrite any line that sounds translated, abstract or syntactically awkward. Prefer a direct instruction or one concrete question.
- If the answer is correct, retry_prompt must be empty.
- corrected_response may fix grammar only; it must never add a missing content point.
- verdict must reflect the private criteria. For this guided worksheet mode, leave reference_answer and story_evidence empty so the learner is not shown the completed worksheet answer.
- should_retry is true when a relevant key idea is still missing, even if the current idea is plausible.
- relevance should be relevant only when the response addresses the task with adequate passage-based reasoning; use partly_relevant when a useful idea is present but another required connection is missing.` : "";

  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.6",
      store: false,
      safety_identifier: payload.familyId,
      reasoning: { effort: "low" },
      instructions: instruction + reasoningInstruction,
      input: JSON.stringify({
        language: targetLanguage,
        level: ageBand,
        task_kind: payload.kind,
        question: payload.prompt,
        story_context: payload.storyContext,
        tester_transcript: payload.transcript,
        target_words: payload.targetWords,
        private_coaching_key_points: guidedReasoning ? payload.keyPoints : [],
      }),
      text: {
        format: {
          type: "json_schema",
          name: "adult_qa_language_feedback",
          strict: true,
          schema,
        },
      },
    }),
  });

  if (!apiResponse.ok) {
    const detail = await apiResponse.text();
    throw new Error(`Language coach request failed (${apiResponse.status}): ${detail.slice(0, 300)}`);
  }

  const raw = await apiResponse.json();
  const text = responseText(raw);
  if (!text) throw new Error("Language coach returned no structured feedback.");
  const feedback = JSON.parse(text) as Feedback;
  const wordEvidence = payload.targetWords.map((targetWord) => {
    const reported = feedback.word_evidence.find((item) => item.target_word === targetWord);
    return reported ?? {
      target_word: targetWord,
      used: false,
      meaningful_use: false,
      matched_form: "",
      reason: "No supported use was identified.",
    };
  });
  const usedWords = wordEvidence.filter((item) => item.used && item.meaningful_use).map((item) => item.target_word);
  const targetLanguageAttempt = feedback.language_status === "target_language" || feedback.language_status === "mostly_target_language";
  const acceptedForProgress = Boolean(
    feedback.accepted_for_progress
    && targetLanguageAttempt
    && feedback.usable
    && feedback.relevance === "relevant"
    && feedback.verdict === "correct"
    && !feedback.should_retry,
  );
  const keyPointsTotal = payload.answerPolicy === "guided_reasoning" ? payload.keyPoints.length : 0;
  const reportedCovered = Number.isFinite(feedback.key_points_covered) ? feedback.key_points_covered : 0;
  const keyPointsCovered = acceptedForProgress
    ? keyPointsTotal
    : Math.max(0, Math.min(keyPointsTotal, Math.trunc(reportedCovered)));
  return {
    ...feedback,
    word_evidence: wordEvidence,
    used_words: usedWords,
    accepted_for_progress: acceptedForProgress,
    key_points_total: keyPointsTotal,
    key_points_covered: keyPointsCovered,
    should_retry: acceptedForProgress ? false : feedback.should_retry || !targetLanguageAttempt || !feedback.usable,
  };
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("adultConfirmed") !== "true") {
      return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
    }
    const familyId = params.get("familyId")?.trim();
    if (!familyId) return Response.json({ error: "familyId is required" }, { status: 400 });
    await ensureStoryResponsesSchema();

    const rows = await getDb()
      .select()
      .from(storyResponses)
      .where(eq(storyResponses.familyId, familyId))
      .orderBy(desc(storyResponses.createdAt))
      .limit(100);

    return Response.json({
      responses: rows.map((row) => ({
        ...row,
        usedWords: JSON.parse(row.usedWordsJson) as string[],
        imageUrl: row.imageKey
          ? `/api/illustrations?id=${encodeURIComponent(row.id)}&familyId=${encodeURIComponent(familyId)}&adultConfirmed=true`
          : null,
      })),
    });
  } catch (error) {
    console.error("Journal read failed", error);
    return Response.json({ error: "The family journal could not be opened." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
  const body = (await request.json()) as ResponsePayload;
  const transcript = body.transcript?.trim() ?? "";
  const familyId = body.familyId?.trim() ?? "";
  const language = body.language;
  const level = body.level;
  const kind = body.kind ?? "question";

  if (!body.adultConfirmed) {
    return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
  }
  if (!familyId || !body.storyTitle || !body.beatId || !language || !level || !body.prompt || !transcript) {
    return Response.json({ error: "Missing response details" }, { status: 400 });
  }
  if (transcript.length > 2500) {
    return Response.json({ error: "Please keep one response under 2,500 characters." }, { status: 400 });
  }

  const complete: Required<ResponsePayload> = {
    adultConfirmed: true,
    familyId,
    storyTitle: body.storyTitle,
    beatId: body.beatId,
    language,
    level,
    kind,
    prompt: body.prompt,
    storyContext: body.storyContext ?? "",
    transcript,
    targetWords: (body.targetWords ?? []).slice(0, 12),
    attempt: Math.max(1, Math.min(body.attempt ?? 1, 20)),
    answerPolicy: body.answerPolicy === "guided_reasoning" ? "guided_reasoning" : "language",
    keyPoints: (body.keyPoints ?? []).slice(0, 8),
  };

  const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string }>();
  let feedback = pendingFeedback(transcript, language, complete.targetWords);
  let aiEvaluated = false;
  if (runtime.OPENAI_API_KEY) {
    try {
      feedback = await evaluateWithAgent(complete, runtime.OPENAI_API_KEY);
      aiEvaluated = true;
    } catch (error) {
      console.error("Language coach unavailable", error);
    }
  }

  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let saved = false;
  let saveWarning = "";
  try {
    await ensureStoryResponsesSchema();
    await getDb().insert(storyResponses).values({
      id,
      familyId,
      storyTitle: complete.storyTitle,
      beatId: complete.beatId,
      language,
      level,
      kind,
      prompt: complete.prompt,
      originalResponse: transcript,
      correctedResponse: feedback.corrected_response,
      relevance: feedback.relevance,
      grammarStatus: feedback.grammar_status,
      encouragement: feedback.encouragement,
      parentNote: feedback.parent_note,
      retryPrompt: feedback.retry_prompt,
      usedWordsJson: JSON.stringify(feedback.used_words),
      shouldRetry: feedback.should_retry,
      aiEvaluated,
      attempt: complete.attempt,
    });
    saved = true;
  } catch (storageError) {
    console.error("Journal persistence unavailable after answer check", storageError);
    saveWarning = "Your answer was checked, but the QA journal could not save this attempt. You can still use the feedback and continue.";
  }

  return Response.json({ id, feedback, aiEvaluated, saved, saveWarning }, { status: saved ? 201 : 200 });
  } catch (error) {
    console.error("Journal save failed", error);
    return Response.json({ error: "The answer could not be saved to the family journal." }, { status: 500 });
  }
}
