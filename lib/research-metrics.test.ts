import { it, expect } from "vitest";
import {
  metricSamples,
  researchMetrics,
  type MetricSample,
} from "./research-metrics";
import type { TradeRow } from "./trade-stats";
const t = {
  id: 1,
  stockId: 1,
  status: "abgeschlossen",
  result: "gewinn",
  direction: "long",
  entryPrice: 100,
  stopLoss: 90,
  takeProfit: 120,
  positionSize: 1,
  actualExitPrice: 101,
  feeEntry: 1,
  feeExit: 1,
  tradedWithMoney: true,
  quoteCurrency: "EUR",
  accountCurrency: "EUR",
  quoteToAccountRate: 1,
} as TradeRow;
it("net fees can turn a labelled winner into a loss; missing fees stay missing", () => {
  expect(metricSamples([t], new Map())[0].net).toBe(-1);
  expect(
    metricSamples([{ ...t, feeEntry: null }], new Map())[0].net,
  ).toBeNull();
});
it("keeps break-even in denominator and excludes unpriced trades, with separate groups", () => {
  const sample = (
    id: number,
    net: number | null,
    kind: "money" | "demo" = "money",
    currency = "EUR",
  ): MetricSample => ({
    id,
    stockId: 1,
    kind,
    net,
    currency,
    plannedCRV: null,
    realizedR: null,
  });
  const m = researchMetrics([
    sample(1, 10),
    sample(2, -10),
    sample(3, 0),
    sample(4, null),
    sample(5, 20, "demo"),
    sample(6, 50, "money", "USD"),
  ]);
  expect(m.money.winRate).toMatchObject({ value: 50, n: 4, missing: 1, denominator:5, ids:[1,2,3,6], excluded:[{id:4,reason:"Vollständiges Nettoergebnis fehlt"}] });
  expect(m.demo.winRate.value).toBe(100);
  expect(m.money.currencies.find((c) => c.currency === "EUR")?.net).toBeNull();
  expect(m.money.currencies.find((c) => c.currency === "USD")?.net).toBe(50);
});
it("requires a recorded original plan instead of reusing a later stop", () => {
  const a = metricSamples([t], new Map())[0];
  expect(a.plannedCRV).toBeNull();
  expect(a.realizedR).toBeNull();
  const m = researchMetrics([a]);
  expect(m.money.averageCRV).toMatchObject({ value: null, n: 0, missing: 1, denominator:1, ids:[] });
});
it("uses original snapshot for planned CRV even when the current target changes", () => {
  const event = {
    id: 1,
    tradeId: 1,
    type: "eroeffnet",
    at: new Date("2026-01-01"),
    price: 100,
    quantity: 1,
    payload: JSON.stringify({
      planningSnapshot: {
        entryPrice: 100,
        stopLoss: 90,
        takeProfit: 130,
        direction: "long",
        positionSize: 1,
        quoteToAccountRate: 1,
        accountCurrency: "EUR",
      },
    }),
  } as any;
  const a = metricSamples(
    [{ ...t, takeProfit: 200 }],
    new Map([[1, [event]]]),
  )[0];
  expect(a.plannedCRV).toBe(3);
  expect(a.net).toBeNull();
  expect(a.realizedR).toBeNull();
});
it("does not count planned or active trades as closed", () =>
  expect(metricSamples([{ ...t, status: "aktiv" }], new Map())).toEqual([]));
