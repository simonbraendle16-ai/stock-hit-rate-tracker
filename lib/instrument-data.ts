import { db } from "@/lib/db";
import {
  assessment,
  quoteSnapshot,
  stock,
  trade,
  tradeEvent,
} from "@/lib/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { computeInstrumentStats, overallGap } from "@/lib/instrument-stats";
import { metricSamples, researchMetrics } from "@/lib/research-metrics";
import { listFib } from "@/lib/fibonacci-service";
import { fibStats } from "@/lib/fibonacci";
import type { TradeEventsByTrade } from "@/lib/trade-stats";
import { nearestEntryByStock, type PlannedEntry } from "@/lib/entry-distance";
export async function loadInstrumentData(userId: string) {
  const [instruments, assessments, trades, events, quotes, observations] =
    await Promise.all([
      db
        .select({
          id: stock.id,
          name: stock.name,
          ticker: stock.ticker,
          market: stock.market,
        })
        .from(stock)
        .where(eq(stock.userId, userId)),
      db
        .select({
          stockId: assessment.stockId,
          isCorrect: assessment.isCorrect,
          zoneNotReached: assessment.zoneNotReached,
        })
        .from(assessment)
        .where(eq(assessment.userId, userId)),
      db.select().from(trade).where(eq(trade.userId, userId)),
      db
        .select()
        .from(tradeEvent)
        .where(eq(tradeEvent.userId, userId))
        .orderBy(asc(tradeEvent.at), asc(tradeEvent.id)),
      db
        .select({
          stockId: stock.id,
          price: quoteSnapshot.price,
          changePct: quoteSnapshot.changePct,
          currency: quoteSnapshot.currency,
          quotedAt: quoteSnapshot.quotedAt,
          fetchedAt: quoteSnapshot.fetchedAt,
        })
        .from(stock)
        .innerJoin(
          quoteSnapshot,
          eq(quoteSnapshot.symbol, stock.providerSymbol),
        )
        .where(eq(stock.userId, userId)),
      listFib(userId),
    ]);
  const eventMap: TradeEventsByTrade = new Map();
  for (const e of events)
    eventMap.set(e.tradeId, [...(eventMap.get(e.tradeId) ?? []), e]);
  const samples = metricSamples(trades, eventMap);
  const cards = computeInstrumentStats(
    instruments,
    assessments,
    trades,
    eventMap,
    true,
  ).map((card) => {
    const rows = observations.filter((r) => r.stockId === card.stockId);
    return {
      ...card,
      research: researchMetrics(
        samples.filter((s) => s.stockId === card.stockId),
      ),
      fibonacci: {
        contexts: new Set(rows.map((r) => r.contextId ?? r.id)).size,
        retracement: fibStats(rows),
        expansion: fibStats(rows, "expansion"),
      },
    };
  });
  const quoteMap: Record<
    number,
    {
      price: number;
      changePct: number | null;
      currency: string | null;
      quotedAt: number;
      fetchedAt: string;
    }
  > = {};
  for (const q of quotes)
    quoteMap[q.stockId] = {
      price: q.price,
      changePct: q.changePct,
      currency: q.currency,
      quotedAt: q.quotedAt,
      fetchedAt: q.fetchedAt.toISOString(),
    };
  return {
    cards,
    quotes: quoteMap,
    entries: Object.fromEntries(
      nearestEntryByStock(
        trades.filter((t) => t.status === "geplant") as PlannedEntry[],
        quoteMap,
      ),
    ),
    overall: overallGap(cards),
    samples,
  };
}
