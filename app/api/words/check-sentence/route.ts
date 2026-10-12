import { getRuntimeEnv } from "../../../../runtime-env";

type Language = "ta" | "zh";

type SentenceCheck = {
  verdict: "makes_sense" | "almost" | "does_not_make_sense";
  used_target_word: boolean;
  matched_form: string;
  feedback: string;
  corrected_sentence: string;
  english_meaning: string;
};

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
      word?: string;
      sentence?: string;
      contextSentence?: string;
      simpleMeaning?: string;
      englishMeaning?: string;
    };

    if (!body.adultConfirmed) return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
    const familyId = body.familyId?.trim() ?? "";
    const language = body.language;
    const word = body.word?.trim() ?? "";
    const sentence = body.sentence?.trim() ?? "";
    if (!familyId || !language || !word || !sentence) return Response.json({ error: "The word and spoken sentence are required." }, { status: 400 });
    if (word.length > 120 || sentence.length > 800) return Response.json({ error: "Keep this practice to one short sentence." }, { status: 400 });

    const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string }>();
    if (!runtime.OPENAI_API_KEY) return Response.json({ error: "The OpenAI sentence checker is not connected." }, { status: 503 });
    const targetLanguage = language === "ta" ? "Tamil" : "Mandarin Chinese";
    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        verdict: { type: "string", enum: ["makes_sense", "almost", "does_not_make_sense"] },
        used_target_word: { type: "boolean" },
        matched_form: { type: "string" },
        feedback: { type: "string" },
        corrected_sentence: { type: "string" },
        english_meaning: { type: "string" },
      },
      required: ["verdict", "used_target_word", "matched_form", "feedback", "corrected_sentence", "english_meaning"],
    };

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": familyId,
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        store: false,
        reasoning: { effort: "low" },
        instructions: `You are a careful ${targetLanguage} vocabulary coach in an adult-only QA prototype. Judge one spoken sentence that is meant to use a target word.

Rules:
- Recognize normal inflections, Tamil case or tense suffixes, Mandarin particles, and plausible speech-transcription variants. Do not require an exact base-form substring.
- For Mandarin, judge the saved word's meaning from dictionary_context_sentence and english_gloss. A homophone or Pinyin-like transcript is not enough to prove misuse; when the intended word and sentence meaning are clear, do not reject it solely because speech recognition selected another same-sounding character. Accept natural tone-sandhi pronunciation and do not require the citation tone in connected speech.
- used_target_word is true only when the target word or a valid inflected form is genuinely present. matched_form must copy the exact form from the transcript, or be empty.
- makes_sense requires both a meaningful use of the target word and a coherent sentence. almost means the intended meaning is recognizable but the word form, grammar, or fit needs one small repair. does_not_make_sense means the target is absent, used with the wrong meaning, or the sentence is incoherent.
- feedback must be one kind, specific sentence in ${targetLanguage}. State plainly what worked or what to change.
- corrected_sentence must preserve the speaker's idea and make the smallest necessary repair. If no repair is needed, repeat the transcript exactly.
- english_meaning is a concise English translation of the resulting sentence. Do not invent missing ideas.
- Do not assign scores, diagnose ability, or claim certainty about a learner.`,
        input: JSON.stringify({
          target_language: targetLanguage,
          target_word: word,
          learner_sentence: sentence,
          dictionary_context_sentence: body.contextSentence?.slice(0, 500) ?? "",
          simple_meaning: body.simpleMeaning?.slice(0, 300) ?? "",
          english_gloss: body.englishMeaning?.slice(0, 300) ?? "",
        }),
        text: { format: { type: "json_schema", name: "word_sentence_check", strict: true, schema } },
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("Word sentence check failed", upstream.status, detail.slice(0, 300));
      return Response.json({ error: "The OpenAI sentence checker could not respond." }, { status: 502 });
    }
    const raw = await upstream.json();
    const text = responseText(raw);
    if (!text) return Response.json({ error: "The sentence checker returned no result." }, { status: 502 });
    const result = JSON.parse(text) as SentenceCheck;
    return Response.json(result);
  } catch (error) {
    console.error("Word sentence check error", error);
    return Response.json({ error: "The sentence could not be checked." }, { status: 500 });
  }
}
