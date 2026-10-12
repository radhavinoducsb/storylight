import { readLatestAssessmentProfile, saveAssessmentProfile } from "../../../../db/assessment-profiles";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { adultConfirmed?: boolean; action?: "save" | "load"; familyId?: string; language?: "ta" | "zh"; level?: "P3" | "P5"; title?: string; strengths?: string[]; focusAreas?: string[]; rubric?: unknown[] };
    if (!body.adultConfirmed) return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
    const familyId = body.familyId?.trim() ?? "";
    if (!familyId || !body.language || !body.level) return Response.json({ error: "The learning profile request is incomplete." }, { status: 400 });
    if (body.action === "load") {
      const profile = await readLatestAssessmentProfile(familyId, body.language, body.level);
      return Response.json({ found: Boolean(profile), profile });
    }
    const strengths = (body.strengths ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 8);
    const focusAreas = (body.focusAreas ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 8);
    if (!strengths.length || !focusAreas.length) return Response.json({ error: "The confirmed learning profile is incomplete." }, { status: 400 });
    const id = await saveAssessmentProfile({ familyId, language: body.language, level: body.level, title: body.title?.slice(0, 200) || "Marked assessment", strengths, focusAreas, rubric: (body.rubric ?? []).slice(0, 10) });
    return Response.json({ saved: true, id });
  } catch (error) {
    console.error("Assessment profile route failed", error);
    return Response.json({ error: "The confirmed learning profile could not be saved." }, { status: 500 });
  }
}
