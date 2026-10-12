import { getRuntimeEnv } from "../../../../runtime-env";
import { responseOutputText } from "../../../../lib/openai-response";

type LearningSignal = {
  id: string;
  label: string;
  mechanic: string;
  description: string;
  score?: number;
  sources?: Array<{ interest: string; weight: number; today: boolean }>;
};
type RequestBody = {
  adultConfirmed?: boolean; language?: "ta" | "zh"; level?: "P3" | "P5";
  worksheetTitle?: string; curriculumText?: string; currentQuestion?: string;
  interests?: string[]; today?: string; customInterest?: string; learningSignals?: LearningSignal[];
};

export async function POST(request: Request) {
  const body = await request.json() as RequestBody;
  if (!body.adultConfirmed) return Response.json({ error: "Adult confirmation is required." }, { status: 403 });
  const interests = (body.interests || []).filter(Boolean).slice(0, 12);
  if (!interests.length) return Response.json({ error: "Choose at least one interest." }, { status: 400 });
  const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string }>();
  if (!runtime.OPENAI_API_KEY) return Response.json({ error: "Interest matching is not connected." }, { status: 503 });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${runtime.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.6-luna", store: false, reasoning: { effort: "low" },
      input: `Design an interest-informed route into this ${body.language} ${body.level} curriculum activity.

Locked curriculum:
Worksheet: ${body.worksheetTitle}
Source: ${body.curriculumText?.slice(0, 5000)}
Question: ${body.currentQuestion?.slice(0, 1000)}

Learner profile:
Today's single activity spark: ${body.today || interests[0]}
Other current interest: ${body.customInterest?.slice(0, 80) || "none"}
Ranked candidate activity signals: ${(body.learningSignals || []).map((item) => `${item.label} [interest weight ${item.score ?? "unscored"}] (${item.mechanic})`).join("; ") || "none"}

Choose exactly one of the ranked candidate activity signals that best fits both the curriculum demand and today's single spark. Copy that candidate's label into thinkingMode and its mechanic into activityMechanic exactly; do not invent a different signal. Curriculum fit is the final gate. An interest is only a hypothesis about an engaging activity action, never proof of a fixed learning style or ability. The overlay must change the learner's visible action and objects—not merely add a themed name. It must not change, rewrite or replace the source, printed question, correct answer, rubric or learning outcome.

Use concrete mappings. Football turns words into players: find the word out of position, substitute the correct one, then read the repaired sentence. Dance turns words into beats: find the broken beat, restore the pattern, then say it in rhythm. Mysteries turn source details into clue cards. Chess turns choices into moves that must be justified. Robots turn an incorrect form into a faulty part to replace. Keep the activity direct and free of irrelevant lore.

Return the selected interest, a fictional companion, an abstract thinking mode, a short activity mechanic, a child-friendly activity title (maximum 6 words), one plain sentence explaining the on-screen visual metaphor, one mission sentence, exactly three brief mission steps that implement the mechanic using the curriculum question, and a transparent parent explanation. Write mission and missionSteps in the learner's target language (${body.language === "zh" ? "Mandarin" : "Tamil"}); write the activity title, visual metaphor and parent explanation in plain English. Never impersonate a celebrity.`,
      text: { format: { type: "json_schema", name: "interest_activity_overlay", strict: true, schema: {
        type: "object", additionalProperties: false,
        properties: {
          selectedInterest: { type: "string" }, companionName: { type: "string" }, thinkingMode: { type: "string" },
          activityMechanic: { type: "string" }, activityTitle: { type: "string" }, visualMetaphor: { type: "string" }, mission: { type: "string" },
          missionSteps: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
          parentReason: { type: "string" },
        },
        required: ["selectedInterest", "companionName", "thinkingMode", "activityMechanic", "activityTitle", "visualMetaphor", "mission", "missionSteps", "parentReason"],
      } } },
    }),
  });
  const data = await response.json();
  const output = responseOutputText(data);
  if (!response.ok || !output) return Response.json({ error: "No suitable activity overlay was returned." }, { status: 502 });
  return Response.json(JSON.parse(output));
}
