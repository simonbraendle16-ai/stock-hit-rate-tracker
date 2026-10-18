import { describe, it, expect } from "vitest";
import {
  RESEARCH_LEVELS,
  DURATION_CLASSES,
  structureCode,
} from "./fibonacci-catalogue";
import { categoricalStats, targetResult } from "./fibonacci-categorical-stats";
import {
  fibStats,
  validateFibInput,
  validateEvidence,
  filterFib,
  fibCsv,
  type FibEvidence,
  type FibObservation,
} from "./fibonacci";
import { fibQuery } from "./fibonacci-query";

const evidence = (extra: Partial<FibEvidence> = {}): FibEvidence => ({
  catalogueVersion: 1,
  waveDirection: "short",
  provenance: "Synthetic categorical QA",
  ...extra,
});
const row = (
  id: string,
  e: Partial<FibEvidence> = {},
  extra: Partial<FibObservation> = {},
): FibObservation => ({
  id,
  version: 1,
  ticker: "TEST",
  name: "Synthetic",
  market: "aktien",
  ...validateFibInput({
    stockId: 1,
    wave: "C",
    degree: "Minor",
    timeframe: "30m",
    observedOn: "2026-01-01",
    status: "abgeschlossen",
    percent: null,
    measurementKind: "expansion",
    evidence: evidence(e),
  }),
  ...extra,
});

describe("categorical Fibonacci research", () => {
  it("keeps the key Fibonacci distinct from target, reversal and exact measurement", () => {
    const r = row("key", { keyFibLevel: 61.8, targetZone: [50,78.6], reversalLocation: "between_levels", reversalZone: [61.8,78.6] }, {wave: "B"});
    expect(r.percent).toBeNull();
    expect(targetResult(r)).toBe("hit");
    const stats = categoricalStats([r, row("absent"), row("open", {keyFibLevel:50}, {status:"laufend"})]);
    expect(stats.keyFibonacci.groups[0]).toMatchObject({wave:"B",n:1,distribution:[{level:61.8,ids:["key"],n:1,share:100}]});
    expect(stats.keyFibonacci.excluded).toHaveLength(2);
    expect(stats.levels.find(l=>l.level===61.8)?.reached).toEqual(["key"]);
    expect(stats.reversals.groups[0].distribution[0].zone).toEqual([61.8,78.6]);
    expect(fibCsv([r])).toContain('""keyFibLevel"":61.8');
    expect(validateEvidence(evidence({keyFibLevel:0})).keyFibLevel).toBe(0);
    expect(validateEvidence(evidence({keyFibLevel:null})).keyFibLevel).toBeNull();
  });
  it("rejects invalid or contradictory key Fibonacci values without guessing missing values", () => {
    for (const keyFibLevel of [76.4, NaN, Infinity, -1, "61.8", []])
      expect(()=>validateEvidence({...evidence(),keyFibLevel})).toThrow();
    expect(()=>validateEvidence(evidence({keyFibLevel:61.8,missedLevels:[50]}))).toThrow();
    expect(()=>validateEvidence(evidence({keyFibLevel:78.6,reversalLocation:"between_levels",reversalZone:[61.8,78.6]}))).toThrow();
    expect(()=>validateEvidence(evidence({keyFibLevel:61.8,targetZone:[50,78.6],targetContact:"not_reached"}))).toThrow();
    expect(()=>row("exact",{keyFibLevel:61.8},{...validateFibInput({stockId:1,wave:"B",degree:"Minor",timeframe:"1d",observedOn:"2026-01-01",status:"abgeschlossen",percent:50,evidence:evidence({keyFibLevel:61.8})})})).toThrow();
    expect(row("legacy",{reachedLevels:[61.8],reversalZone:[61.8,78.6],reversalLocation:"between_levels"}).evidence?.keyFibLevel).toBeUndefined();
  });
  it("offers exactly four orders of the confirmed levels without 76.4 or 127.2", () => {
    expect(RESEARCH_LEVELS).toHaveLength(28);
    expect(new Set(RESEARCH_LEVELS).size).toBe(28);
    for (const prefix of [0, 100, 200, 300])
      for (const fraction of [23.6, 38.2, 50, 61.8, 78.6, 88.7])
        expect(RESEARCH_LEVELS).toContain(
          Math.round((prefix + fraction) * 10) / 10,
        );
    expect(RESEARCH_LEVELS).not.toContain(76.4);
    expect(RESEARCH_LEVELS).not.toContain(127.2);
    expect(RESEARCH_LEVELS).not.toContain(423.6);
  });
  it("accepts omitted and empty notes and no expansion basis", () => {
    const r = row("C", {
      targetZone: [123.6, 138.2],
      reversalLocation: "at_level",
      reversalZone: [100, 100],
      targetContact: "not_reached",
    });
    expect(r.note).toBe("");
    expect(r.measurementBasis).toBeNull();
    expect(r.percent).toBeNull();
    expect(targetResult(r)).toBe("miss");
    const s = fibStats([r], "expansion");
    expect(s.n).toBe(0);
    expect(s.categorical.targets[0]).toMatchObject({
      n: 1,
      share: 0,
      miss: ["C"],
    });
    expect(s.categorical.levels.find((l) => l.level === 100)).toMatchObject({
      n: 1,
      reached: ["C"],
      share: 100,
    });
    expect(s.categorical.levels.find((l) => l.level === 123.6)?.missed).toEqual(
      ["C"],
    );
    expect(fibCsv([r])).toContain('""catalogueVersion"":1');
  });
  it("distinguishes contact, reversal, unknown, interval overlap and inclusive target edges", () => {
    const base = {
      targetZone: [123.6, 138.2] as [number, number],
      targetContact: "reached" as const,
    };
    expect(targetResult(row("touch", base))).toBe("unknown");
    expect(
      targetResult(
        row("through", {
          ...base,
          reversalLocation: "at_level",
          reversalZone: [161.8, 161.8],
        }),
      ),
    ).toBe("miss");
    for (const edge of [123.6, 138.2])
      expect(
        targetResult(
          row("edge", {
            ...base,
            reversalLocation: "at_level",
            reversalZone: [edge, edge],
          }),
        ),
      ).toBe("hit");
    expect(
      targetResult(
        row("between", {
          ...base,
          reversalLocation: "between_levels",
          reversalZone: [100, 123.6],
        }),
      ),
    ).toBe("miss");
    expect(
      targetResult(
        row("overlap", {
          ...base,
          reversalLocation: "between_levels",
          reversalZone: [100, 138.2],
        }),
      ),
    ).toBe("unknown");
    expect(
      targetResult(
        row(
          "running",
          {
            ...base,
            reversalLocation: "at_level",
            reversalZone: [138.2, 138.2],
          },
          { status: "laufend" },
        ),
      ),
    ).toBe("unknown");
  });
  it("does not count missing level information as failure and deduplicates revisions", () => {
    const r = row("one", { reachedLevels: [50, 61.8, 100] });
    const s = categoricalStats([
      r,
      { ...r, version: 2, evidence: evidence({ reachedLevels: [100] }) },
      row("unknown"),
    ]);
    expect(s.total).toBe(2);
    expect(s.levels.find((v) => v.level === 100)).toMatchObject({
      n: 1,
      reached: ["one"],
      missed: [],
      share: 100,
    });
    expect(s.levels.find((v) => v.level === 50)?.n).toBe(0);
  });
  it("reports reversal frequencies without a target, keeps intervals separate, and respects timeframe", () => {
    const rows = [
      row("at", { reversalLocation: "at_level", reversalZone: [100, 100] }),
      row("at2", { reversalLocation: "at_level", reversalZone: [100, 100] }),
      row("range", {
        reversalLocation: "between_levels",
        reversalZone: [100, 123.6],
      }),
      row(
        "other-frame",
        { reversalLocation: "at_level", reversalZone: [100, 100] },
        { timeframe: "1w" },
      ),
      row("unknown"),
    ];
    const s = categoricalStats(rows).reversals;
    expect(s.groups).toHaveLength(2);
    const g = s.groups.find((v) => v.timeframe === "30m")!;
    expect(g.n).toBe(3);
    expect(g.distribution.find((d) => d.zone[0] === d.zone[1])).toMatchObject({
      n: 2,
      ids: ["at", "at2"],
    });
    expect(g.distribution.find((d) => d.zone[0] !== d.zone[1])?.n).toBe(1);
    expect(s.excluded).toEqual([
      { id: "unknown", reason: "Umkehrlevel/-bereich nicht erhoben" },
    ]);
  });
  it("separates multi-year and intraday B duration distributions and never averages classes", () => {
    const make = (
      bucket: "d90_180" | "h4_12",
      degree: string,
      timeframe: string,
      id: string,
    ) =>
      row(
        id,
        {
          targetZone: [123.6, 138.2],
          durations: {
            residence: {
              bucket,
              timeBasis: "calendar",
              convention: "first_visit",
              zone: [123.6, 138.2],
            },
          },
        },
        { wave: "B", degree, timeframe },
      );
    const rows = [
      make("d90_180", "Zyklus", "1w", "long"),
      make("h4_12", "Minor", "30m", "short"),
    ];
    const groups = categoricalStats(rows).durations.groups;
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.n === 1 && !("average" in g))).toBe(true);
    expect(
      groups
        .find((g) => g.timeframe === "1w")
        ?.distribution.find((d) => d.bucket === "d90_180")?.n,
    ).toBe(1);
    expect(
      filterFib(rows, { degree: "Minor", timeframe: "30m" }).map((r) => r.id),
    ).toEqual(["short"]);
  });
  it("separates zone snapshots, time bases and first versus total stays", () => {
    const e = evidence({
      targetZone: [123.6, 138.2],
      durations: {
        residence: {
          bucket: "h4_12",
          timeBasis: "calendar",
          convention: "first_visit",
          zone: [100, 123.6],
        },
      },
    });
    const rows = [
      row("one", e),
      row("total", {
        ...e,
        durations: {
          residence: { ...e.durations!.residence!, convention: "total_visits" },
        },
      }),
      row("trading", {
        ...e,
        durations: {
          residence: { ...e.durations!.residence!, timeBasis: "trading" },
        },
      }),
      row("other-zone", {
        ...e,
        durations: {
          residence: { ...e.durations!.residence!, zone: [123.6, 138.2] },
        },
      }),
    ];
    expect(categoricalStats(rows).durations.groups).toHaveLength(4);
    expect(categoricalStats(rows).durations.groups[0].zone).toEqual([
      100, 123.6,
    ]);
  });
  it("classifies legacy exact calendar boundaries without inventing interval midpoints", () => {
    const old = (value: number) => ({
      kind: "exact" as const,
      value,
      unit: "hour" as const,
      timeBasis: "calendar" as const,
      measurementConvention: "first_visit",
      touchAndGo: false,
      zone: [100, 138.2] as [number, number],
      originalText: null,
    });
    const rows = [
      row("one", { targetZoneResidence: old(1) }),
      row("four", { targetZoneResidence: old(4) }),
      row("day", { targetZoneResidence: old(24) }),
      row("bound", {
        targetZoneResidence: {
          kind: "upper_bound",
          upper: 1,
          upperInclusive: false,
          unit: "day",
          timeBasis: "calendar",
          measurementConvention: "first_visit",
          touchAndGo: true,
          zone: [100, 138.2],
          originalText: null,
        },
      }),
    ];
    const s = categoricalStats(rows).durations;
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0].included.map((v) => v.bucket)).toEqual([
      "d1_3",
      "h4_12",
      "h1_4",
    ]);
    expect(
      s.excluded.some((v) => v.id === "bound" && v.type === "residence"),
    ).toBe(true);
    expect(DURATION_CLASSES.at(-1)?.[1]).toBe("Ab 365 Tagen");
  });
  it("keeps legacy exact duration averages separated by wave degree timeframe and zone", () => {
    const duration = {
      kind: "exact" as const,
      value: 9,
      unit: "hour" as const,
      timeBasis: "calendar" as const,
      measurementConvention: "first_visit",
      touchAndGo: false,
      zone: [100, 138.2] as [number, number],
      originalText: null,
    };
    const s = fibStats(
      [
        row("a", { targetZoneResidence: duration }),
        row(
          "b",
          { targetZoneResidence: { ...duration, value: 150, unit: "day" } },
          { degree: "Zyklus", timeframe: "1w" },
        ),
      ],
      "expansion",
    );
    expect(s.coverage.residenceComparisons.groups).toHaveLength(2);
    expect(
      s.coverage.residenceComparisons.groups
        .map((g) => g.average)
        .sort((a, b) => a - b),
    ).toEqual([9, 3600]);
  });
  it("normalizes only unambiguous structures and supports subtype and family filters", () => {
    expect(structureCode("ABC")).toBe("abc");
    expect(structureCode("Flat")).toBe("abc_flat");
    expect(structureCode("ABC oder WXY?")).toBeNull();
    const rows = [
      row("flat", { structureCode: "flat_expanded" }),
      row("abc", { structureCode: "abc" }),
    ];
    expect(
      filterFib(rows, { structure: "family:abc_flat" }).map((r) => r.id),
    ).toEqual(["flat"]);
    expect(
      fibQuery(
        new URLSearchParams(
          "structure=flat_expanded&degree=Minor&timeframe=30m",
        ),
      ).filters.structure,
    ).toBe("flat_expanded");
    expect(() =>
      fibQuery(new URLSearchParams("structure=arbitrary")),
    ).toThrow();
  });
  it.each([
    { reachedLevels: [104.7] },
    { entryZone: [50, 38.2] },
    { targetZone: [123.6, 104.7] },
    { structureCode: "Anything" },
    { catalogueVersion: 2 },
    { reversalLocation: "at_level", reversalZone: [100, 123.6] },
    { reversalLocation: "between_levels", reversalZone: [100, 100] },
    {
      reversalLocation: "at_level",
      reversalZone: [100, 100],
      missedLevels: [100],
    },
    {
      targetContact: "not_reached",
      targetZone: [100, 138.2],
      reachedLevels: [123.6],
    },
    { targetContact: ["reached"] },
    {
      durations: {
        residence: {
          bucket: "h4_12",
          timeBasis: "calendar",
          convention: "first_visit",
        },
      },
    },
    {
      targetContact: "not_reached",
      durations: {
        residence: {
          bucket: "h4_12",
          timeBasis: "calendar",
          convention: "first_visit",
          zone: [100, 138.2],
        },
      },
    },
  ])("rejects inconsistent categorical input %#", (patch) =>
    expect(() => validateEvidence({ ...evidence(), ...patch })).toThrow(),
  );
});
