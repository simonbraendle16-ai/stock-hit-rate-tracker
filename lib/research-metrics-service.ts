import { db } from "@/lib/db";
import { trade, tradeEvent } from "@/lib/db/schema";
import { eq, and, inArray, asc } from "drizzle-orm";
import { metricSamples } from "@/lib/research-metrics";
import type { TradeEventsByTrade } from "@/lib/trade-stats";
export async function loadMetricSamples(userId: string, ids?: number[]) {
  if (ids && !ids.length) return [];
  const rows = await db
    .select()
    .from(trade)
    .where(
      and(
        eq(trade.userId, userId),
        eq(trade.status, "abgeschlossen"),
        ids ? inArray(trade.id, ids) : undefined,
      ),
    );
  if (!rows.length) return [];
  const events = await db
    .select()
    .from(tradeEvent)
    .where(
      and(
        eq(tradeEvent.userId, userId),
        inArray(
          tradeEvent.tradeId,
          rows.map((t) => t.id),
        ),
      ),
    )
    .orderBy(asc(tradeEvent.at), asc(tradeEvent.id));
  const map: TradeEventsByTrade = new Map();
  for (const e of events)
    map.set(e.tradeId, [...(map.get(e.tradeId) ?? []), e]);
  return metricSamples(rows, map);
}

export async function loadTradeCoverage(userId: string) {
  return db.select({ticker:trade.ticker,result:trade.result,id:trade.id, stockId:trade.stockId, status:trade.status, direction:trade.direction,
    wave:trade.elliottWaveCount, degree:trade.waveDegree, notes:trade.notes, planContext:trade.planContext,
    plannedCRV:trade.riskRewardRatio}).from(trade).where(eq(trade.userId,userId));
}
