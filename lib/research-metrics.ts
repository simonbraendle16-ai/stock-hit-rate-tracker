import {
  tradeNetPnl,
  type TradeRow,
  type TradeEventsByTrade,
} from "@/lib/trade-stats";
import { settlePosition } from "@/lib/trade-events";
export type MetricSample = {
  id: number;
  stockId: number | null;
  kind: "money" | "demo";
  net: number | null;
  currency: string | null;
  plannedCRV: number | null;
  realizedR: number | null;
};
export function metricSamples(
  trades: TradeRow[],
  events: TradeEventsByTrade,
): MetricSample[] {
  return trades
    .filter((t) => t.status === "abgeschlossen")
    .map((t) => {
      const es = events.get(t.id) ?? [];
      let net: number | null = null;
      if (es.length) {
        const settled = settlePosition(t, es);
        if (
          settled.moneyComplete &&
          settled.isFullyClosed &&
          Number.isFinite(settled.totalNet)
        )
          net = settled.totalNet;
      } else if (
        t.result &&
        t.actualExitPrice != null &&
        (!t.tradedWithMoney || (t.feeEntry != null && t.feeExit != null))
      )
        net = tradeNetPnl(t);
      if (net !== null && !Number.isFinite(net)) net = null;
      let plannedCRV: number | null = null,
        risk: number | null = null;
      try {
        const opened = es
          .filter((e) => e.type === "eroeffnet")
          .sort(
            (a, b) =>
              new Date(a.at).getTime() - new Date(b.at).getTime() ||
              a.id - b.id,
          )[0];
        const p = JSON.parse(opened?.payload ?? "{}").planningSnapshot;
        if (
          p &&
          [p.entryPrice, p.stopLoss, p.takeProfit].every(
            (v: unknown) => typeof v === "number" && Number.isFinite(v),
          )
        ) {
          const d =
            p.direction === "short" ? -1 : p.direction === "long" ? 1 : 0;
          const distance = (p.entryPrice - p.stopLoss) * d,
            chance = (p.takeProfit - p.entryPrice) * d;
          if (distance > 0 && chance > 0) plannedCRV = chance / distance;
          if (
            distance > 0 &&
            Number.isFinite(p.positionSize) &&
            p.positionSize > 0 &&
            Number.isFinite(p.quoteToAccountRate) &&
            p.quoteToAccountRate > 0 &&
            p.accountCurrency === t.accountCurrency
          )
            risk = distance * p.positionSize * p.quoteToAccountRate;
        }
      } catch {}
      return {
        id: t.id,
        stockId: t.stockId,
        kind: t.tradedWithMoney ? "money" : "demo",
        net,
        currency: t.accountCurrency ?? null,
        plannedCRV,
        realizedR:
          net !== null && risk !== null && risk > 0 ? net / risk : null,
      };
    });
}
export function researchMetrics(samples: readonly MetricSample[]) {
  const metric = (values: (number | null)[]) => {
    const known = values.filter(
      (v): v is number => v !== null && Number.isFinite(v),
    );
    return {
      value: known.length
        ? known.reduce((a, b) => a + b, 0) / known.length
        : null,
      n: known.length,
      missing: values.length - known.length,
    };
  };
  const group = (kind: "money" | "demo") => {
    const rows = samples.filter((s) => s.kind === kind),
      known = rows.filter((s) => s.net !== null),
      wins = known.filter((s) => s.net! > 0).length;
    const currencies = [
      ...new Set(rows.map((s) => s.currency).filter((c): c is string => !!c)),
    ]
      .sort()
      .map((currency) => {
        const selected = rows.filter((s) => s.currency === currency),
          values = selected.filter((s) => s.net !== null);
        return {
          currency,
          n: values.length,
          missing: selected.length - values.length,
          net:
            values.length === selected.length
              ? values.reduce((sum, s) => sum + s.net!, 0)
              : null,
        };
      });
    return {
      completed: rows.length,
      winRate: {
        value: known.length ? (wins / known.length) * 100 : null,
        n: known.length,
        missing: rows.length - known.length,
      },
      averageCRV: metric(rows.map((s) => s.plannedCRV)),
      averageR: metric(rows.map((s) => s.realizedR)),
      currencies,
    };
  };
  return { money: group("money"), demo: group("demo") };
}
export type ResearchMetrics = ReturnType<typeof researchMetrics>;
