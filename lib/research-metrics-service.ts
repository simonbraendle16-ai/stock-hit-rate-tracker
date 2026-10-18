import { db } from "@/lib/db";
import { trade, tradeEvent, portfolio } from "@/lib/db/schema";
import { eq, and, inArray, asc } from "drizzle-orm";
import { metricSamples } from "@/lib/research-metrics";
import type { TradeEventsByTrade } from "@/lib/trade-stats";

/** Depot ownership and meaning are authoritative; never repairs stored trade data. */
export async function loadOwnedResearchTrades(userId: string, ids?: number[], completed = false) {
  if (ids && !ids.length) return [];
  const rows = await db.select({trade, portfolioKind:portfolio.kind})
    .from(trade)
    .innerJoin(portfolio,and(eq(portfolio.id,trade.portfolioId),eq(portfolio.userId,userId)))
    .where(and(eq(trade.userId,userId),inArray(portfolio.kind,["demo","echtgeld"]),
      completed ? eq(trade.status,"abgeschlossen") : undefined,
      ids ? inArray(trade.id,ids) : undefined));
  return rows.map(({trade:row,portfolioKind})=>({
    ...row,
    kind: portfolioKind === "echtgeld" ? "money" as const : "demo" as const,
    kindMismatch: row.tradedWithMoney !== (portfolioKind === "echtgeld"),
    tradedWithMoney: portfolioKind === "echtgeld",
  }));
}
export async function loadMetricSamples(userId: string, ids?: number[]) {
  const rows = await loadOwnedResearchTrades(userId,ids,true);
  if (!rows.length) return [];
  const events = await db.select().from(tradeEvent)
    .where(and(eq(tradeEvent.userId,userId),inArray(tradeEvent.tradeId,rows.map(t=>t.id))))
    .orderBy(asc(tradeEvent.at),asc(tradeEvent.id));
  const map: TradeEventsByTrade = new Map();
  for (const e of events) map.set(e.tradeId,[...(map.get(e.tradeId) ?? []),e]);
  return metricSamples(rows,map);
}
export async function loadTradeCoverage(userId: string) {
  return (await loadOwnedResearchTrades(userId)).map(r=>({
    id:r.id,stockId:r.stockId,ticker:r.ticker,result:r.result,status:r.status,direction:r.direction,
    wave:r.elliottWaveCount,degree:r.waveDegree,notes:r.notes,planContext:r.planContext,
    plannedCRV:r.riskRewardRatio,portfolioId:r.portfolioId,kind:r.kind,kindMismatch:r.kindMismatch,
  }));
}
