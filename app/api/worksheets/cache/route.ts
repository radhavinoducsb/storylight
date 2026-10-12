import {
  clearWorksheetCache,
  readWorksheetCache,
  writeWorksheetCache,
} from "../../../../db/worksheet-cache";

type CacheAction = "lookup" | "save" | "clear-family";
type CacheKind = "set" | "batch";

type CacheRequest = {
  adultConfirmed?: boolean;
  action?: CacheAction;
  familyId?: string;
  cacheKind?: CacheKind;
  cacheKey?: string;
  language?: "ta" | "zh";
  level?: "P3" | "P5";
  payload?: unknown;
};

function validToken(value: string, maximum: number) {
  return value.length > 0 && value.length <= maximum && /^[a-zA-Z0-9:_-]+$/.test(value);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CacheRequest;
    if (!body.adultConfirmed) {
      return Response.json({ error: "Adult QA confirmation is required." }, { status: 403 });
    }

    const familyId = body.familyId?.trim() ?? "";
    if (!validToken(familyId, 100)) {
      return Response.json({ error: "A valid browser workspace is required." }, { status: 400 });
    }

    if (body.action === "clear-family") {
      await clearWorksheetCache(familyId);
      return Response.json({ cleared: true });
    }

    const cacheKey = body.cacheKey?.trim() ?? "";
    if (
      (body.cacheKind !== "set" && body.cacheKind !== "batch")
      || !validToken(cacheKey, 160)
      || (body.language !== "ta" && body.language !== "zh")
      || (body.level !== "P3" && body.level !== "P5")
    ) {
      return Response.json({ error: "The worksheet cache request is incomplete." }, { status: 400 });
    }

    if (body.action === "lookup") {
      const cached = await readWorksheetCache(familyId, body.cacheKind, cacheKey, body.language, body.level);
      return Response.json(cached ? { found: true, ...cached } : { found: false });
    }

    if (body.action === "save") {
      const serialized = JSON.stringify(body.payload ?? null);
      if (serialized.length > 750_000) {
        return Response.json({ error: "This saved analysis is too large to cache safely." }, { status: 413 });
      }
      await writeWorksheetCache(
        familyId,
        body.cacheKind,
        cacheKey,
        body.language,
        body.level,
        body.payload ?? null,
      );
      return Response.json({ saved: true });
    }

    return Response.json({ error: "Unknown worksheet cache action." }, { status: 400 });
  } catch (error) {
    console.error("Worksheet cache route failed", error);
    return Response.json({ error: "The saved worksheet analysis is temporarily unavailable." }, { status: 500 });
  }
}
