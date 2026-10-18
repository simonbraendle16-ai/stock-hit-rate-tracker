import { formatWaveDegree } from "@/lib/wave-degree-labels";
import { RESEARCH_LEVELS, RESEARCH_WAVES, STRUCTURES, DURATION_CLASSES } from "@/lib/fibonacci-catalogue";
import { loadTradeCoverage, loadMetricSamples } from "@/lib/research-metrics-service";
import { researchMetrics } from "@/lib/research-metrics";
import { fibonacciReadModel } from "@/lib/fibonacci-read-model";
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
  fibStats, FIB_DEGREES,
} from "@/lib/fibonacci";
export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, "trades:read"),
      p = req.nextUrl.searchParams;
    const { filters, limit, offset, search, selection } = fibQuery(p);
    const items = selectResearchRows(await listFib(userId, filters.stockId), filters, search, selection);
    const [allSamples, tradeCoverage] = await Promise.all([loadMetricSamples(userId), loadTradeCoverage(userId)]);
    return NextResponse.json({
      ...fibonacciReadModel(items,tradeCoverage,allSamples,filters.stockId),
      tradeCoverage: tradeCoverage.filter(s => !filters.stockId || s.stockId === filters.stockId),
      allTradeMetrics: researchMetrics(allSamples.filter(s => !filters.stockId || s.stockId === filters.stockId)),
      items: items.slice(offset, offset + limit),
      total: items.length,
      nextOffset: offset + limit < items.length ? offset + limit : null,
      allTradeSamples: allSamples.filter(s => !filters.stockId || s.stockId === filters.stockId),
      basis: {
        filters, search, selection,
        dates: "from/to filtern observedOn (Erfassungsdatum). Historische Zeiträume stehen separat im Datensatz und sind über search auffindbar.",
        allTrades: "Alle eingetragenen Trades qualitativ, Geldkennzahlen nur abgeschlossene Trades; nur Instrumentfilter; Wellenfilter gelten hier nicht. Fehlende Abrechnung blockiert ausschließlich Geldkennzahlen.",
        waves: "Ausgewählte Beobachtungen nach stabiler ID und Messart; neueste Revision je ID. Abschlusskennzahlen und vorläufige laufende Angaben getrennt.",
        trades: "Eindeutig verknüpfte eigene Trades mit passendem Instrument, nach jeweiligem Trade-Status; Netto nur abgeschlossene Trades.",
        legacy: "tradeSummary und tradeResearchCoverage bleiben gemischte Gesamtansichten; getrennte Bereiche verwenden die ByKind-Gruppen. Prognosen bleiben eigener assessment-Bestand.",
      },
      catalogue: {version:1,degrees:FIB_DEGREES.map(value=>({value,label:formatWaveDegree(value)})),levels:RESEARCH_LEVELS,waves:RESEARCH_WAVES,structures:STRUCTURES.map(([code,label,parent])=>({code,label,parent})),durationClasses:DURATION_CLASSES.map(([code,label])=>({code,label}))},
      stats: fibStats(items, filters.measurementKind),
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
