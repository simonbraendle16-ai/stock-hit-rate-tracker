import { describe, it, expect } from "vitest";
import {
  selectResearchRows,
  orderResearchRows,
  formatResearchPercent,
} from "./fibonacci-workspace";
import { fibStats, fibCsv, type FibObservation } from "./fibonacci";

const row = (
  id: string,
  patch: Partial<FibObservation> = {},
): FibObservation => ({
  id,
  version: 1,
  stockId: 1,
  ticker: "QA",
  name: "Prüffall",
  market: "aktien",
  wave: "4",
  degree: "Minor",
  timeframe: "2h",
  observedOn: "2026-10-01",
  status: "abgeschlossen",
  percent: 61.8,
  anchorStart: null,
  anchorEnd: null,
  extreme: null,
  note: "Quelle Testchart",
  measurementKind: "retracement",
  ...patch,
});
describe("research workspace population", () => {
  it("uses intersecting filters, all search words and measurement kind for statistics and CSV", () => {
    const rows = [
      row("a"),
      row("b", { measurementKind: "expansion" }),
      row("c", { stockId: 2 }),
      row("d", { note: "Andere Herkunft" }),
    ];
    const selected = selectResearchRows(
      rows,
      { stockId: 1, measurementKind: "retracement" },
      "pruffall TESTCHART",
    );
    expect(selected.map((r) => r.id)).toEqual(["a"]);
    expect(fibStats(selected, "retracement").n).toBe(1);
    expect(fibCsv(selected)).toContain('"a"');
    expect(fibCsv(selected)).not.toContain('"b"');
    expect(selectResearchRows(rows, {}, "nicht vorhanden")).toEqual([]);
  });
  it("separates an absent value from zero, and completed descriptive cases from usable samples", () => {
    const rows = [
      row("zero", { percent: 0 }),
      row("missing", { percent: null }),
      row("running", { status: "laufend" }),
    ];
    expect(
      selectResearchRows(rows, {}, "", "missing").map((r) => r.id),
    ).toEqual(["missing"]);
    expect(
      selectResearchRows(rows, {}, "", "running").map((r) => r.id),
    ).toEqual(["running"]);
    expect(
      selectResearchRows(rows, { status: "laufend" }, "", "completed"),
    ).toEqual([]);
    expect(fibStats(selectResearchRows(rows, {}, "", "completed")).n).toBe(1);
    expect(formatResearchPercent(0)).toBe("0 %");
    expect(formatResearchPercent(null)).toBe("—");
  });
  it("sorts missing values last for depth without mutating the population or its metrics", () => {
    const rows = [
      row("missing", { percent: null }),
      row("zero", { percent: 0, observedOn: "2026-10-03" }),
      row("deep", { percent: 100, observedOn: "2026-10-02" }),
    ];
    const before = fibStats(rows);
    expect(orderResearchRows(rows, "deepest").map((r) => r.id)).toEqual([
      "deep",
      "zero",
      "missing",
    ]);
    expect(orderResearchRows(rows, "newest").map((r) => r.id)).toEqual([
      "zero",
      "deep",
      "missing",
    ]);
    expect(orderResearchRows(rows, "oldest").map((r) => r.id)).toEqual([
      "missing",
      "deep",
      "zero",
    ]);
    expect(rows.map((r) => r.id)).toEqual(["missing", "zero", "deep"]);
    expect(fibStats(orderResearchRows(rows, "deepest"))).toEqual(before);
  });
});
