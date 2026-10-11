import { NextRequest, NextResponse } from "next/server";
import {
  requireApiScope,
  apiResponseError,
  readJsonObject,
  requestKey,
  ApiError,
} from "@/lib/assistant-api";
import {
  listHistory,
  saveHistory,
  snapshotStoredHistory,
} from "@/lib/fibonacci-history-service";
import type { HistoryInput } from "@/lib/fibonacci-history";
export async function GET(req: NextRequest) {
  try {
    const user = await requireApiScope(req, "trades:read");
    const raw = req.nextUrl.searchParams.get("stockId");
    const id = raw === null ? undefined : Number(raw);
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0))
      throw new ApiError(400, "Ungültiges Instrument.");
    return NextResponse.json({ items: await listHistory(user, id) });
  } catch (e) {
    return apiResponseError(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const user = await requireApiScope(req, "trades:write"),
      id = requestKey(req),
      body = await readJsonObject(req, 8_000_000);
    const row =
      body.origin === "cache"
        ? await snapshotStoredHistory(
            user,
            id,
            body as unknown as Omit<HistoryInput, "candles" | "origin">,
            Number(body.from),
            Number(body.to),
          )
        : await saveHistory(user, id, body as unknown as HistoryInput);
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    return apiResponseError(e);
  }
}
