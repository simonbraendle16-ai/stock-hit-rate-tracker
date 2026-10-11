import { NextRequest, NextResponse } from "next/server";
import { requireApiScope, apiResponseError, uuidId } from "@/lib/assistant-api";
import { getFibRevisions } from "@/lib/fibonacci-service";
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    return NextResponse.json({
      items: await getFibRevisions(
        await requireApiScope(req, "trades:read"),
        uuidId((await params).id),
      ),
    });
  } catch (e) {
    return apiResponseError(e);
  }
}
