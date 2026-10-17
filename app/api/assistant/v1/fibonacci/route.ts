import { loadTradeCoverage, loadMetricSamples } from "@/lib/research-metrics-service";
import { researchMetrics } from "@/lib/research-metrics";
import { tradeResearchCoverage } from "@/lib/trade-research-coverage";
import { selectResearchRows } from "@/lib/fibonacci-workspace";
import { fibQuery } from "@/lib/fibonacci-query";
import { NextRequest, NextResponse } from "next/server";
import {
  ApiError,
  apiResponseError,
  requireApiScope,
  readJsonObject,
  requestKey,
} from "@/lib/assistant-api";
import { listFib, saveFib } from "@/lib/fibonacci-service";
import {
  filterFib,
  fibStats,
  FIB_WAVES,
  FIB_DEGREES,
  FIB_TIMEFRAMES,
} from "@/lib/fibonacci";
export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, "trades:read"),
      p = req.nextUrl.searchParams;
    const { filters, limit, offset, search, selection } = fibQuery(p);
    const items = selectResearchRows(await listFib(userId, filters.stockId), filters, search, selection);
    const [allSamples, tradeCoverage] = await Promise.all([loadMetricSamples(userId), loadTradeCoverage(userId)]);
    return NextResponse.json({
      tradeResearchCoverage: tradeResearchCoverage(tradeCoverage.filter(s=>!filters.stockId || s.stockId===filters.stockId)),
      tradeCoverage: tradeCoverage.filter(s => !filters.stockId || s.stockId === filters.stockId),
      allTradeMetrics: researchMetrics(allSamples.filter(s => !filters.stockId || s.stockId === filters.stockId)),
      items: items.slice(offset, offset + limit),
      total: items.length,
      nextOffset: offset + limit < items.length ? offset + limit : null,
      allTradeSamples: allSamples.filter(s => !filters.stockId || s.stockId === filters.stockId),
      metrics: researchMetrics(allSamples.filter(s => items.some(r=>r.status === "abgeschlossen" && r.tradeId === s.id))),
      basis: {
        filters, search, selection,
        dates: "from/to filtern observedOn (Erfassungsdatum). Historische Zeiträume stehen separat im Datensatz und sind über search auffindbar.",
        allTrades: "Alle eingetragenen Trades qualitativ, Geldkennzahlen nur abgeschlossene Trades; nur Instrumentfilter; Wellenfilter gelten hier nicht. Fehlende Abrechnung blockiert ausschließlich Geldkennzahlen.",
        waves: "Alle Beobachtungen; Kennzahlen jeweils nach Status und vorhandener strukturierter Angabe je Kontext und Messart",
        trades: "Eindeutig verknüpfte abgeschlossene Trades, jeweils einmal",
      },
      stats: fibStats(items, filters.measurementKind),
      statsByKind: {
        retracement: fibStats(items, "retracement"),
        expansion: fibStats(items, "expansion"),
      },
    });
  } catch (e) {
    return apiResponseError(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const owner = await requireApiScope(req, "trades:write");
    return NextResponse.json(
      await saveFib(owner, requestKey(req), await readJsonObject(req)),
      { status: 201 },
    );
  } catch (e) {
    return apiResponseError(e);
  }
}
