import { getRuntimeEnv } from "../../../../runtime-env";
import { bytesToDataUrl, responseOutputText } from "../../../../lib/openai-response";

const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    if (form.get("adultConfirmed") !== "true") {
      return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
    }
    const previews = form.getAll("previews").filter((item): item is File => item instanceof File && item.size > 0);
    if (!previews.length || previews.length > 8) {
      return Response.json({ error: "Upload between one and eight page previews." }, { status: 400 });
    }
    if (previews.some((file) => !ACCEPTED_TYPES.has(file.type))) {
      return Response.json({ error: "Page sequencing currently uses JPG, PNG or WEBP previews." }, { status: 400 });
    }
    const totalBytes = previews.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > 7 * 1024 * 1024) {
      return Response.json({ error: "The page previews are too large to sequence together." }, { status: 413 });
    }

    const runtime = getRuntimeEnv<{ OPENAI_API_KEY?: string }>();
    if (!runtime.OPENAI_API_KEY) {
      return Response.json({ error: "OpenAI page sequencing is not connected." }, { status: 503 });
    }
    const language = form.get("language") === "zh" ? "Mandarin Chinese" : "Tamil";
    const level = form.get("level") === "P5" ? "Singapore Primary 5" : "Singapore Primary 3";
    const content: Array<Record<string, unknown>> = [{
      type: "input_text",
      text: `Arrange these ${language} ${level} worksheet or book-page candidates into their most likely reading sequence. Use visible page numbers first, then headings, paragraph continuation, sentence continuity, question numbering and story chronology. Candidate indices are zero-based. Return every candidate exactly once. Do not extract or reproduce the full page text. If the order is uncertain, still choose the most plausible sequence and explain the uncertainty briefly.`,
    }];
    for (let index = 0; index < previews.length; index += 1) {
      content.push({ type: "input_text", text: `Candidate ${index}; uploaded filename: ${previews[index].name}` });
      content.push({ type: "input_image", image_url: await bytesToDataUrl(previews[index]), detail: "low" });
    }

    const schema = {
      type: "object",
      additionalProperties: false,
      properties: {
        pages: {
          type: "array",
          minItems: previews.length,
          maxItems: previews.length,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              original_index: { type: "integer" },
              page_marker: { type: "string" },
              continuity_note: { type: "string" },
            },
            required: ["original_index", "page_marker", "continuity_note"],
          },
        },
        confidence_note: { type: "string" },
      },
      required: ["pages", "confidence_note"],
    };

    const apiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6",
        store: false,
        reasoning: { effort: "low" },
        input: [{ role: "user", content }],
        text: { format: { type: "json_schema", name: "worksheet_page_order", strict: true, schema } },
      }),
    });
    if (!apiResponse.ok) {
      const detail = await apiResponse.text();
      console.error("Worksheet ordering failed", apiResponse.status, detail.slice(0, 500));
      return Response.json({ error: "The page order could not be identified. You can try again or upload fewer pages." }, { status: 502 });
    }
    const raw = await apiResponse.json();
    const output = responseOutputText(raw);
    if (!output) return Response.json({ error: "No page order was returned." }, { status: 502 });
    return Response.json(JSON.parse(output));
  } catch (error) {
    console.error("Worksheet ordering route failed", error);
    return Response.json({ error: "The page sequence could not be prepared." }, { status: 500 });
  }
}
