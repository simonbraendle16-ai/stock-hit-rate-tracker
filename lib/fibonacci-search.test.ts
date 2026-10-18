import { describe, it, expect } from "vitest";
import { interpretFibSearch } from "./fibonacci-search";
import { levelMatchGroups, levelSearchGroups } from "./fibonacci-level-search";
import { selectResearchRows } from "./fibonacci-workspace";
import {
  type FibObservation,
  type FibEvidence,
  fibCsv,
  latestObservations,
  validateEvidence,
} from "./fibonacci";

const instruments = [
  { id: 1, ticker: "TSLA", name: "Tesla Inc" },
  { id: 2, ticker: "TES", name: "Tesla Alternative" },
  { id: 3, ticker: "AAPL", name: "Apple Inc" },
];
const row = (
  id: string,
  evidence: FibEvidence = {},
  patch: Partial<FibObservation> = {},
): FibObservation => ({
  id,
  version: 1,
  stockId: 1,
  ticker: "TSLA",
  name: "Tesla Inc",
  market: "aktien",
  wave: "4",
  degree: "Minor",
  timeframe: "1d",
  observedOn: "2026-10-18",
  status: "abgeschlossen",
  percent: null,
  anchorStart: null,
  anchorEnd: null,
  extreme: null,
  note: "",
  evidence,
  ...patch,
});
const at = (value: number): FibEvidence => ({
  catalogueVersion: 1,
  reversalLocation: "at_level",
  reversalZone: [value, value],
});
describe("T4 end and zone semantics", () => {
  const q = { levelFrom: 61.8, levelMeaning: "end" as const };
  it("keeps the parallel key Fibonacci evidence independent from an end location", () => {
    expect(levelMatchGroups(row("key-only", {keyFibLevel:61.8}), q)).toEqual([]);
    expect(levelMatchGroups(row("key-and-end", {...at(61.8), keyFibLevel:61.8}), q)).toEqual(["catalogueEndLevels"]);
  });
  it("separates catalogue, historical precision and inclusive reversal zones without admitting maxima/passed/exit", () => {
    const rows = [
      row("at", at(61.8)),
      row("zone", {
        reversalLocation: "between_levels",
        reversalZone: [61.8, 88.7],
      }),
      row("hist", {
        reversalLocation: "at_level",
        reversalZone: [61.8, 61.8],
        reversalPrecision: "exact",
      }),
      row("approx", {
        reversalLocation: "at_level",
        reversalZone: [61.8, 61.8],
        reversalPrecision: "approximate",
      }),
      row("passed", { reachedLevels: [61.8] }),
      row("exit", { hypotheticalExitLevel: 61.8 }),
      row("max", {}, { percent: 61.8 }),
      row("ambiguous", { reversalZone: [61.8, 61.8] }),
    ];
    const g = levelSearchGroups(rows, q);
    expect(g.total).toBe(4);
    expect(g.groups.catalogueEndLevels).toEqual(["at"]);
    expect(g.groups.historicalExact).toEqual(["hist"]);
    expect(g.groups.historicalApproximate).toEqual(["approx"]);
    expect(g.groups.reversalZones).toEqual(["zone"]);
    expect(
      levelMatchGroups(
        row("edge", {
          reversalLocation: "between_levels",
          reversalZone: [50, 61.8],
        }),
        q,
      ),
    ).toEqual(["reversalZones"]);
    expect(
      levelMatchGroups(
        row("outside", {
          reversalLocation: "between_levels",
          reversalZone: [61.81, 88.7],
        }),
        q,
      ),
    ).toEqual([]);
  });
  it.each(["laufend", "unklar", "ungueltig"] as const)(
    "does not promote %s reversals to wave ends",
    (status) => {
      expect(levelMatchGroups(row("x", at(61.8), { status }), q)).toEqual([]);
    },
  );
  it("keeps targets and observed running reversals separate and ignores missing duration", () => {
    const r = row(
      "x",
      { ...at(61.8), targetZone: [50, 78.6] },
      { status: "laufend" },
    );
    expect(levelMatchGroups(r, { ...q, levelMeaning: "reversal" })).toEqual([
      "observedReversals",
    ]);
    expect(levelMatchGroups(r, { ...q, levelMeaning: "target" })).toEqual([
      "targetZones",
    ]);
    expect(levelMatchGroups(row("x", at(61.8)), q)).toEqual([
      "catalogueEndLevels",
    ]);
  });
  it("does not round historical locations, rejects non-catalogue queries, deduplicates totals", () => {
    expect(
      levelMatchGroups(
        row("x", {
          reversalLocation: "at_level",
          reversalZone: [61.81, 61.81],
        }),
        q,
      ),
    ).toEqual([]);
    expect(
      levelSearchGroups([row("x", at(61.8)), row("x", at(61.8))], q).total,
    ).toBe(1);
    expect(
      levelSearchGroups([], { ...q, levelFrom: 61.81 }).error,
    ).toBeTruthy();
    expect(
      selectResearchRows([row("x", at(61.8))], { ...q, levelTo: 50 }),
    ).toEqual([]);
  });
  it("does not borrow end precision from a maximum and validates only explicit additive evidence", () => {
    const e = validateEvidence({
      reversalLocation: "at_level",
      reversalZone: [61.8, 61.8],
      approximatePercent: 61.8,
      provenance: "Explicit historical location",
    });
    expect(levelMatchGroups(row("unknown-precision", e), q)).toEqual([
      "historicalUnspecified",
    ]);
    expect(
      validateEvidence({ ...e, reversalPrecision: "approximate" })
        .reversalPrecision,
    ).toBe("approximate");
    expect(() =>
      validateEvidence({ ...e, reversalPrecision: "rounded" }),
    ).toThrow();
  });
  it("shares manual selection, revision handling and existing export population", () => {
    const rows = [
      row("same", at(50), { version: 1 }),
      row("same", at(61.8), { version: 2 }),
      row("other", { reachedLevels: [61.8] }),
    ];
    const chosen = selectResearchRows(rows, q);
    expect(chosen.map((r) => r.id)).toEqual(["same"]);
    expect(chosen[0].version).toBe(2);
    expect(fibCsv(chosen)).not.toContain('"other"');
    expect(levelSearchGroups(latestObservations(rows), q).ids).toEqual([
      "same",
    ]);
  });
});
describe("T5 deterministic structured interpretation", () => {
  it("returns all three explicit choices for the agreed example and applies their intersection", () => {
    const query = "Tesla Welle 4 2020–2025 ABC 61,8";
    const unresolved = interpretFibSearch(query, instruments);
    expect(unresolved.pending.map((p) => p.key)).toEqual([
      "instrument:0",
      "waveLabelScope",
      "levelMeaning",
    ]);
    expect(unresolved.ready).toBe(false);
    expect(unresolved.unknown).toEqual([]);
    const solved = interpretFibSearch(
      query,
      instruments,
      {},
      { "instrument:0": "1", waveLabelScope: "self", levelMeaning: "end" },
    );
    expect(solved.ready).toBe(true);
    expect(solved.filters).toEqual({
      stockId: 1,
      wave: "4",
      from: "2020",
      to: "2025",
      timeBasis: "historical",
      structure: "family:abc",
      waveLabelScope: "self",
      levelFrom: 61.8,
      levelMeaning: "end",
    });
  });
  it.each([
    "TSLA Welle 4 2020–2025 ABC 61,8",
    " tsla  welle 4 2020—2025 abc 61.8 ",
    "TsLa WELLE 4 2020‑2025 AbC 61.8",
  ])("normalizes equivalent query %s", (query) => {
    const result = interpretFibSearch(
      query,
      instruments,
      {},
      { waveLabelScope: "self", levelMeaning: "end" },
    );
    expect(result.ready).toBe(true);
    expect(result.filters.stockId).toBe(1);
    expect(result.filters.levelFrom).toBe(61.8);
    expect(result.filters.from).toBe("2020");
  });
  it("supports named meaning, range, multiword instrument, degree, timeframe, status and hierarchy", () => {
    const r = interpretFibSearch(
      "Tesla Inc Welle 4 inklusive Unterwellen 2020-2025 ABC Minor 2H abgeschlossen Endlevel 61,8–88,7",
      instruments,
    );
    expect(r.ready).toBe(true);
    expect(r.filters).toMatchObject({
      stockId: 1,
      wave: "4",
      waveLabelScope: "descendants",
      levelFrom: 61.8,
      levelTo: 88.7,
      degree: "Minor",
      timeframe: "2h",
      status: "abgeschlossen",
    });
  });
  it.each([
    "TSLA Banane",
    "Welle 4 Welle 5",
    "2025-2020",
    "Endlevel 61.81",
    "Endlevel",
    "61.8-50 Endlevel",
    "Endlevel Zielzone 61.8",
    "laufend abgeschlossen",
    "TSLA AAPL",
  ])("blocks unknown or contradictory %s", (query) => {
    const r = interpretFibSearch(
      query,
      instruments,
      {},
      { waveLabelScope: "self", levelMeaning: "end" },
    );
    expect(r.ready).toBe(false);
    expect(r.unknown.length + r.conflicts.length).toBeGreaterThan(0);
  });
  it("does not silently override manual filters or trust invalid resolutions", () => {
    expect(interpretFibSearch("TSLA", instruments, { stockId: 3 }).ready).toBe(
      false,
    );
    expect(
      interpretFibSearch("Tesla", instruments, {}, { "instrument:0": "999" })
        .pending,
    ).toHaveLength(1);
  });
  it("supports explicit self scope and the subscript wave without losing tokens", () => {
    expect(
      interpretFibSearch("nur Welle 4", instruments).filters,
    ).toMatchObject({ wave: "4", waveLabelScope: "self" });
    expect(interpretFibSearch("Welle x₂ selbst", instruments).ready).toBe(true);
    expect(
      interpretFibSearch("Welle X₂ Welle selbst", instruments).filters,
    ).toMatchObject({ wave: "X₂", waveLabelScope: "self" });
    expect(interpretFibSearch("a".repeat(2001), instruments).ready).toBe(false);
  });
  it("keeps completed versus running scope and main/subwaves independent", () => {
    expect(selectResearchRows([row("legacy-case",{}, {wave:"c"})],{wave:"C"}).map(r=>r.id)).toEqual(["legacy-case"]);
    const root = row("root", at(61.8));
    const child = row(
      "child",
      { ...at(61.8), parentId: "root" },
      { wave: "A" },
    );
    const other = row("unrelated", at(61.8), { wave: "A" });
    expect(
      selectResearchRows([root, child, other], {
        wave: "4",
        waveLabelScope: "self",
      }).map((r) => r.id),
    ).toEqual(["root"]);
    expect(
      selectResearchRows([root, child, other], {
        wave: "4",
        waveLabelScope: "descendants",
      }).map((r) => r.id),
    ).toEqual(["root", "child"]);
    expect(
      selectResearchRows([root, child, other], {
        wave: "4",
        waveLabelScope: "descendants",
        hierarchyRole: "subwaves",
      }).map((r) => r.id),
    ).toEqual(["child"]);
  });
});
