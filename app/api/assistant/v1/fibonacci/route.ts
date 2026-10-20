import { SUBDIVISIONS, SUBDIVISION_CONFIDENCES } from "@/lib/fibonacci-subdivision";
import { db } from "@/lib/db";
import { stock } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { researchResult, researchCsv } from "@/lib/fibonacci-research";
import { formatWaveDegree } from "@/lib/wave-degree-labels";
import { WAVE_VARIANTS } from "@/lib/fibonacci-wave-variants";
import { durationDefinitions } from "@/lib/fibonacci-duration-definitions";
import { RESEARCH_LEVELS, RESEARCH_WAVES, STRUCTURES, DURATION_CLASSES } from "@/lib/fibonacci-catalogue";
import { loadTradeCoverage, loadMetricSamples } from "@/lib/research-metrics-service";
import { researchMetrics } from "@/lib/research-metrics";
import { fibonacciReadModel } from "@/lib/fibonacci-read-model";
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
  FIB_DEGREES,
} from "@/lib/fibonacci";
export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiScope(req, "trades:read"),
      p = req.nextUrl.searchParams;
    const request = fibQuery(p);
    const [rows, instruments] = await Promise.all([
      listFib(userId, request.filters.stockId),
      db.select({id:stock.id,name:stock.name,ticker:stock.ticker}).from(stock).where(eq(stock.userId,userId)),
    ]);
    const result = researchResult(rows, instruments, request);
    const {filters,selected:items} = result;
    const {search,selection,order,query,resolutions} = request;
    if (request.format === "csv") {
      if (!result.ready) throw new ApiError(422,"Suchkriterien vor dem Export vollständig klären.");
      return new NextResponse(researchCsv(result), {headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="fibonacci-beobachtungen.csv"',"Cache-Control":"private, no-store"}});
    }
    const [allSamples, tradeCoverage] = await Promise.all([loadMetricSamples(userId), loadTradeCoverage(userId)]);
    return NextResponse.json({
      ...(result.ready ? fibonacciReadModel(items,tradeCoverage,allSamples,filters.stockId) : {}),
      ready: result.ready, error:result.error, interpretation:result.interpretation, levelSelection:result.levelSelection,
      tradeCoverage: tradeCoverage.filter(s => !filters.stockId || s.stockId === filters.stockId),
      allTradeMetrics: researchMetrics(allSamples.filter(s => !filters.stockId || s.stockId === filters.stockId)),
      items: result.items,
      total: result.total,
      timeSelection: result.timeSelection,
      nextOffset: result.nextOffset,
      allTradeSamples: allSamples.filter(s => !filters.stockId || s.stockId === filters.stockId),
      basis: {
        filters, search, selection, order, query, resolutions, limit:request.limit, offset:request.offset,
        dates: "from/to filtern standardmäßig historische Überlappung mit sicheren Treffern. timeBasis=recorded wählt observedOn als dokumentiertes Erfassungsdatum. timeMatch wählt certain/possible/unknown/all; timeSelection nennt alle Gruppen vor Pagination.",
        allTrades: "Alle eingetragenen Trades qualitativ, Geldkennzahlen nur abgeschlossene Trades; nur Instrumentfilter; Wellenfilter gelten hier nicht. Fehlende Abrechnung blockiert ausschließlich Geldkennzahlen.",
        waves: "Ausgewählte Beobachtungen nach stabiler ID und Messart; neueste Revision je ID. Abschlusskennzahlen und vorläufige laufende Angaben getrennt.",
        trades: "Eindeutig verknüpfte eigene Trades mit passendem Instrument, nach jeweiligem Trade-Status; Netto nur abgeschlossene Trades.",
        legacy: "tradeSummary und tradeResearchCoverage bleiben gemischte Gesamtansichten; getrennte Bereiche verwenden die ByKind-Gruppen. Prognosen bleiben eigener assessment-Bestand.",
      },
      catalogue: {version:1,subdivisions:SUBDIVISIONS,subdivisionConfidences:SUBDIVISION_CONFIDENCES,degrees:FIB_DEGREES.map(value=>({value,label:formatWaveDegree(value)})),levels:RESEARCH_LEVELS,waves:RESEARCH_WAVES,waveVariants:WAVE_VARIANTS,structures:STRUCTURES.map(([code,label,parent])=>({code,label,parent})),durationClasses:DURATION_CLASSES.map(([code,label])=>({code,label})),durationDefinitions},
      stats: result.stats,
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
