import { NextRequest, NextResponse } from "next/server";
import { requireApiScope, apiResponseError } from "@/lib/assistant-api";
import { loadInstrumentData } from "@/lib/instrument-data";
export async function GET(req: NextRequest) {
  try {
    const { cards, quotes } = await loadInstrumentData(
      await requireApiScope(req, "trades:read"),
    );
    return NextResponse.json({
      basis: "Instrument-Gesamtwerte über alle Depots",
      items: cards.map((c) => ({ ...c, quote: quotes[c.stockId] ?? null })),
    });
  } catch (e) {
    return apiResponseError(e);
  }
}
