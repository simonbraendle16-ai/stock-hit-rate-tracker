import { NextRequest, NextResponse } from "next/server";
import {
  requireApiScope,
  apiResponseError,
  ApiError,
} from "@/lib/assistant-api";
import { db } from "@/lib/db";
import { stock } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { listFib } from "@/lib/fibonacci-service";
import { selectResearchRows, researchTimeGroups } from "@/lib/fibonacci-workspace";
import { fibQuery } from "@/lib/fibonacci-query";
export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, "trades:read"),
      p = req.nextUrl.searchParams;
    const { filters, limit, offset } = fibQuery(p, true);
    const query = p.get("instrument")?.trim().toLocaleLowerCase();
    if (p.has("instrument") && (!query || query.length > 200))
      throw new ApiError(400, "Ungültiger Instrumentfilter.");
    const owned = await db
      .select({
        id: stock.id,
        name: stock.name,
        ticker: stock.ticker,
        market: stock.market,
      })
      .from(stock)
      .where(eq(stock.userId, userId));
    const instruments = owned.filter(
      (s) =>
        (!filters.stockId || s.id === filters.stockId) &&
        (!filters.market || s.market === filters.market) &&
        (!query ||
          s.name.toLocaleLowerCase() === query ||
          s.ticker.toLocaleLowerCase() === query),
    );
    const ids = new Set(instruments.map((s) => s.id));
    const rows = (await listFib(userId, filters.stockId)).filter(r=>ids.has(r.stockId));
    const matches = selectResearchRows(rows,filters);
    const contexts = [
      ...new Map(
        matches.map((r) => [
          r.contextId ?? r.id,
          {
            contextId: r.contextId ?? r.id,
            stockId: r.stockId,
            wave: r.wave,
            degree: r.degree,
            timeframe: r.timeframe,
            periodFrom: r.periodFrom,
            periodTo: r.periodTo,
          },
        ]),
      ).values(),
    ];
    return NextResponse.json({
      timeSelection: researchTimeGroups(rows,filters),
      contexts,
      instruments,
      candidates: matches.slice(offset, offset + limit),
      total: matches.length,
      nextOffset: offset + limit < matches.length ? offset + limit : null,
      resolution:
        instruments.length !== 1
          ? "instrument_unklar"
          : contexts.length === 1
            ? "eindeutig"
            : contexts.length
              ? "mehrdeutig"
              : "neuer_fall",
    });
  } catch (e) {
    return apiResponseError(e);
  }
}
