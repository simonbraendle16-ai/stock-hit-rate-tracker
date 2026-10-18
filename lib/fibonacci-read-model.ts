import { fibStats, runningFibStats, simulationSummary, latestObservations, type FibObservation } from "./fibonacci";
import { researchMetrics, type MetricSample } from "./research-metrics";
import { tradeResearchByKind, summarizeTradeResearch, tradeResearchCoverage, uniqueTrades, type TradeResearchRow } from "./trade-research-coverage";

/** Shared by the API and internal views; rows are already selected, trades are owned. */
export function fibonacciReadModel(observations: readonly FibObservation[], trades: readonly TradeResearchRow[], samples: readonly MetricSample[], stockId?: number) {
  const selected = latestObservations(observations).sort((a,b)=>a.id.localeCompare(b.id));
  const allTrades = uniqueTrades(trades).filter(t=>!stockId || t.stockId === stockId);
  const tradeMap = new Map(allTrades.map(t=>[t.id,t]));
  const links = selected.filter(r=>r.tradeId != null);
  const valid = links.filter(r=>tradeMap.get(r.tradeId!)?.stockId === r.stockId);
  const linkedIds = new Set(valid.map(r=>r.tradeId!));
  const linkedTrades = allTrades.filter(t=>linkedIds.has(t.id));
  const linkedGroups = tradeResearchByKind(linkedTrades);
  const allSamples = uniqueTrades(samples).filter(s=>!stockId || s.stockId === stockId);
  const linkedSamples = allSamples.filter(s=>linkedIds.has(s.id) && tradeMap.get(s.id)?.status === "abgeschlossen" && tradeMap.get(s.id)?.stockId === s.stockId);
  return {
    ...tradeResearchByKind(allTrades),
    tradeSummary: summarizeTradeResearch(allTrades),
    tradeResearchCoverage: tradeResearchCoverage(allTrades),
    simulationSummary: simulationSummary(selected),
    runningStatsByKind: {retracement:runningFibStats(selected,"retracement"),expansion:runningFibStats(selected,"expansion")},
    statsByKind: {retracement:fibStats(selected,"retracement"),expansion:fibStats(selected,"expansion")},
    linkedTradeSummaryByKind: linkedGroups.tradeSummaryByKind,
    linkedTradeResearchCoverageByKind: linkedGroups.tradeResearchCoverageByKind,
    linkedTradeBasis: {
      definition: "Eigene Trades mit passender Instrumentzuordnung aus ausgewählten Beobachtungen, pro Trade einmal; Trade-Status unabhängig vom Wellenstatus.",
      ids: [...linkedIds],
      included: valid.map(r=>({observationId:r.id,tradeId:r.tradeId})),
      excluded: links.filter(r=>!valid.includes(r)).map(r=>({observationId:r.id,tradeId:r.tradeId,reason:"Kein eigener zulässiger Trade mit passendem Instrument und Depot"})),
    },
    metrics: researchMetrics(linkedSamples),
  };
}
