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

it("renders the absent exact modal zone as missing for a descriptive-only instrument",()=>{const s=fibStats([{id:"synthetic",version:1,stockId:1,ticker:"TEST",name:"Synthetic",market:"aktien",wave:"B",degree:"unbekannt",timeframe:"1d",observedOn:"2026-01-01",status:"abgeschlossen",percent:null,anchorStart:null,anchorEnd:null,extreme:null,note:"Synthetic source",evidence:{reachedLevels:[38.2],provenance:"Synthetic"}}]);expect(s.coverage.total).toBe(1);expect(s.n).toBe(0);expect(formatResearchPercent(s.modes[0])).toBe("—");});

it("finds a historical ISO date independently of the captured-on date",()=>{const historical=row("historical",{observedOn:"2026-10-01",periodFrom:"2025-12-03",periodTo:"2026-04-06",percent:null});expect(selectResearchRows([historical],{},"2025-12-03").map(r=>r.id)).toEqual(["historical"]);expect(selectResearchRows([historical],{from:"2026-10-01"},"2025-12-03")).toHaveLength(1);expect(selectResearchRows([historical],{from:"2026-10-02"},"2025-12-03")).toHaveLength(0);});
