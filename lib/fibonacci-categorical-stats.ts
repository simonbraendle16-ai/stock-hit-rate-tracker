import { residenceConflict, reversalConflict } from "./fibonacci-duration-compatibility";
import { ZONE_TO_PIVOT } from "./fibonacci-duration-definitions";
import { WAVE_VARIANTS, waveVariant, waveVariantError } from "./fibonacci-wave-variants";
import type { FibObservation } from "./fibonacci";
import { latestObservations } from "./fibonacci";
import {
  DURATION_CLASSES,
  RESEARCH_LEVELS,
  STRUCTURES,
  structureCode,
  type ClassifiedDuration,
} from "./fibonacci-catalogue";

export function targetResult(r: FibObservation): "hit" | "miss" | "unknown" {
  const e = r.evidence,
    t = e?.targetZone,
    z = e?.reversalZone;
  if (
    !t ||
    r.status !== "abgeschlossen" ||
    e?.measurementConfidence === "unklar"
  )
    return "unknown";
  if (e?.targetContact === "not_reached") return "miss";
  if (!z) return "unknown";
  if (z[0] >= t[0] && z[1] <= t[1]) return "hit";
  if (
    z[1] < t[0] ||
    z[0] > t[1] ||
    (e?.reversalLocation === "between_levels" &&
      (z[1] === t[0] || z[0] === t[1]))
  )
    return "miss";
  return "unknown";
}

function durationOf(
  r: FibObservation,
  type: "wave" | "reversal" | "residence",
): { duration: ClassifiedDuration | null; reason?: string } {
  const e = r.evidence;
  if (r.status !== "abgeschlossen")
    return { duration: null, reason: `Status ${r.status}` };
  if (type === "residence" && e?.targetContact === "not_reached")
    return { duration: null, reason: "Zielzone nicht erreicht" };
  if (type === "residence" && residenceConflict(e)) return {duration:null,reason:residenceConflict(e)!};
  if (type === "reversal" && reversalConflict(e)) return {duration:null,reason:reversalConflict(e)!};
  const d = e?.durations?.[type];
  if (d)
    return d.bucket === "unknown"
      ? { duration: null, reason: "Dauer unbekannt" }
      : { duration: d };
  // Existing exact calendar values can be classified without inventing precision.
  const old = type === "residence" ? e?.targetZoneResidence : type === "reversal" ? e?.targetZoneReversal : null;
  if (
    (type !== "residence" && type !== "reversal") ||
    !old ||
    old.kind !== "exact" ||
    old.timeBasis !== "calendar" ||
    !old.measurementConvention
  )
    return {
      duration: null,
      reason: old
        ? "Altdauer nicht eindeutig klassifizierbar"
        : "Dauerklasse nicht erhoben",
    };
  const hours = old.value! * { minute: 1 / 60, hour: 1, day: 24 }[old.unit];
  const bucket = DURATION_CLASSES.find(
    ([, , lo, hi]) => hours >= lo && hours < hi,
  )?.[0];
  const convention =
    old.measurementConvention === "first_visit" ||
    old.measurementConvention === "total_visits"
      ? old.measurementConvention
      : old.measurementConvention === ZONE_TO_PIVOT ? ZONE_TO_PIVOT : "unknown";
  return bucket
    ? { duration: { bucket, timeBasis: "calendar", convention } }
    : { duration: null, reason: "Dauer nicht klassifizierbar" };
}

export function categoricalStats(rows: readonly FibObservation[]) {
  rows = latestObservations(rows).sort((a, b) => a.id.localeCompare(b.id));
  const eligible = rows.filter(
    (r) =>
      r.status === "abgeschlossen" &&
      r.evidence?.measurementConfidence !== "unklar",
  );
  const levels = RESEARCH_LEVELS.map((level) => {
    const reached = eligible
      .filter(
        (r) =>
          r.evidence?.reachedLevels?.includes(level) ||
          r.evidence?.keyFibLevel === level ||
          (r.evidence?.reversalLocation === "at_level" &&
            r.evidence.reversalZone?.[0] === level),
      )
      .map((r) => r.id);
    const missed = eligible
      .filter(
        (r) =>
          r.evidence?.missedLevels?.includes(level) ||
          (r.evidence?.targetContact === "not_reached" &&
            r.evidence.targetZone &&
            level >= r.evidence.targetZone[0] &&
            level <= r.evidence.targetZone[1]),
      )
      .map((r) => r.id);
    const ids = new Set([...reached, ...missed]);
    return {
      level,
      reached,
      missed,
      n: ids.size,
      share: ids.size ? (reached.length / ids.size) * 100 : null,
      excluded: rows
        .filter((r) => !ids.has(r.id))
        .map((r) => ({
          id: r.id,
          reason:
            r.status !== "abgeschlossen"
              ? `Status ${r.status}`
              : "Keine bestätigte Angabe zu diesem Level",
        })),
    };
  });
  const targetGroups = new Map<
    string,
    {
      wave: string;
      degree: string;
      timeframe: string;
      zone: number[];
      timing: string;
      hit: string[];
      miss: string[];
      unknown: string[];
    }
  >();
  for (const r of rows) {
    if (!r.evidence?.targetZone) continue;
    const zone = r.evidence.targetZone,
      timing = r.evidence.expectationTiming ?? "unknown";
    const key = JSON.stringify([
      r.wave,
      r.degree,
      r.timeframe,
      r.measurementKind ?? "retracement",
      zone,
      timing,
    ]);
    const g = targetGroups.get(key) ?? {
      wave: r.wave,
      degree: r.degree,
      timeframe: r.timeframe,
      zone,
      timing,
      hit: [],
      miss: [],
      unknown: [],
    };
    g[targetResult(r)].push(r.id);
    targetGroups.set(key, g);
  }
  const durationGroups = new Map<
    string,
    {
      type: string;
      wave: string;
      degree: string;
      timeframe: string;
      measurementKind: string;
      zone: number[] | null;
      timeBasis: string;
      convention: string;
      legacyConvention: string | null;
      unit: string;
      included: { id: string; bucket: string }[];
    }
  >();
  const excluded: { id: string; type: string; reason: string }[] = [];
  for (const r of rows)
    for (const type of ["wave", "reversal", "residence"] as const) {
      const { duration: d, reason } = durationOf(r, type);
      const zone =
        type === "residence"
          ? (d?.zone ??
            r.evidence?.targetZoneResidence?.zone ??
            r.evidence?.targetZone ??
            null)
          : type === "reversal"
            ? (d?.zone ?? r.evidence?.targetZoneReversal?.zone ?? r.evidence?.reversalZone ?? null)
            : null;
      if (!d || (type === "residence" && !zone)) {
        excluded.push({ id: r.id, type, reason: reason ?? "Zonenbezug fehlt" });
        continue;
      }
      // Trading-day classes must not be converted to hours. Their original class remains the unit.
      const unit =
        d.timeBasis === "trading"
          ? d.bucket.startsWith("d") || d.bucket === "ge_365d"
            ? "trading_days"
            : "trading_hours"
          : d.timeBasis === "calendar"
            ? "calendar_hours"
            : "unknown";
      const legacyConvention = !r.evidence?.durations?.[type] && type !== "reversal"
        ? (r.evidence?.targetZoneResidence?.measurementConvention ?? null)
        : null;
      const dimensions = {
        type,
        wave: r.wave,
        degree: r.degree,
        timeframe: r.timeframe,
        measurementKind: r.measurementKind ?? "retracement",
        zone,
        timeBasis: d.timeBasis,
        convention: d.convention,
        legacyConvention,
        unit,
      };
      const key = JSON.stringify(dimensions);
      const g = durationGroups.get(key) ?? { ...dimensions, included: [] };
      g.included.push({ id: r.id, bucket: d.bucket });
      durationGroups.set(key, g);
    }
  const structures = STRUCTURES.filter(([c]) => c !== "unknown").map(
    ([code, label, parent]) => ({
      code,
      label,
      parent,
      ids: eligible
        .filter(
          (r) =>
            (r.evidence?.structureCode ?? structureCode(r.structure)) === code,
        )
        .map((r) => r.id),
    }),
  );
  const reversalGroups = new Map<
    string,
    {
      wave: string;
      degree: string;
      timeframe: string;
      measurementKind: string;
      included: FibObservation[];
    }
  >();
  for (const r of eligible.filter((r) => r.evidence?.reversalZone)) {
    const dimensions = {
      wave: r.wave,
      degree: r.degree,
      timeframe: r.timeframe,
      measurementKind: r.measurementKind ?? "retracement",
    };
    const key = JSON.stringify(dimensions),
      g = reversalGroups.get(key) ?? { ...dimensions, included: [] };
    g.included.push(r);
    reversalGroups.set(key, g);
  }
  return {
    definition:
      "Beobachtete relative Häufigkeiten; unbekannte Angaben sind keine Verfehlungen. Jede Welle zählt pro Kennzahl einmal.",
    total: rows.length,
    waveVariants: waveVariantStats(rows),
    keyFibonacci: keyFibonacciStats(rows),
    levels,
    structures,
    structureFamilies: [...new Set(STRUCTURES.map(([, , parent]) => parent))]
      .filter((v) => v !== "unknown")
      .map((parent) => ({
        parent,
        ids: eligible
          .filter(
            (r) =>
              STRUCTURES.find(
                ([code]) =>
                  code ===
                  (r.evidence?.structureCode ?? structureCode(r.structure)),
              )?.[2] === parent,
          )
          .map((r) => r.id),
      })),
    reversals: {
      excluded: rows
        .filter((r) => !eligible.includes(r) || !r.evidence?.reversalZone)
        .map((r) => ({
          id: r.id,
          reason:
            r.status !== "abgeschlossen"
              ? `Status ${r.status}`
              : r.evidence?.measurementConfidence === "unklar"
                ? "Messart ungeklärt"
                : "Umkehrlevel/-bereich nicht erhoben",
        })),
      groups: [...reversalGroups.values()].map(({ included, ...g }) => {
        const zones = [
          ...new Set(
            included.map((r) => JSON.stringify(r.evidence!.reversalZone)),
          ),
        ];
        return {
          ...g,
          n: included.length,
          distribution: zones.map((key) => {
            const zone = JSON.parse(key) as [number, number],
              ids = included
                .filter((r) => JSON.stringify(r.evidence!.reversalZone) === key)
                .map((r) => r.id);
            return {
              zone,
              ids,
              n: ids.length,
              share: (ids.length / included.length) * 100,
            };
          }),
        };
      }),
    },
    targets: [...targetGroups.values()].map((g) => ({
      ...g,
      n: g.hit.length + g.miss.length,
      share:
        g.hit.length + g.miss.length
          ? (g.hit.length / (g.hit.length + g.miss.length)) * 100
          : null,
    })),
    durations: {
      excluded,
      groups: [...durationGroups.values()].map((g) => ({
        ...g,
        n: g.included.length,
        distribution: DURATION_CLASSES.map(([bucket, label]) => {
          const ids = g.included
            .filter((r) => r.bucket === bucket)
            .map((r) => r.id);
          return {
            bucket,
            label,
            ids,
            n: ids.length,
            share: (ids.length / g.included.length) * 100,
          };
        }),
      })),
    },
  };
}

function waveVariantStats(rows: readonly FibObservation[]) {
  const groups = new Map<string, {wave:string;degree:string;timeframe:string;measurementKind:string;rows:FibObservation[]}>();
  for (const row of rows) {
    const wave = row.wave.trim().toUpperCase();
    if (wave !== "B" && wave !== "C") continue;
    const dimensions = {wave, degree:row.degree, timeframe:row.timeframe, measurementKind:row.measurementKind ?? "retracement"};
    const key = JSON.stringify(dimensions), group = groups.get(key) ?? {...dimensions, rows:[]};
    group.rows.push(row); groups.set(key, group);
  }
  return [...groups.values()].map(({rows,...dimensions}) => {
    const reason = (r:FibObservation) => r.status !== "abgeschlossen" ? `Status ${r.status}` : r.evidence?.measurementConfidence === "unklar" ? "Messart ungeklärt" : waveVariantError(r.wave,r.evidence?.waveVariant) ?? (!waveVariant(r.evidence?.waveVariant) ? "Wellenvariante nicht erhoben" : null);
    const included = rows.filter(r => !reason(r));
    return {...dimensions, denominator:rows.length, n:included.length,
      excluded:rows.filter(r => reason(r)).map(r => ({id:r.id,reason:reason(r)!})),
      distribution:WAVE_VARIANTS.filter(v => v.wave === dimensions.wave).map(v => {
        const ids = included.filter(r => r.evidence?.waveVariant === v.code).map(r => r.id);
        return {...v, ids, n:ids.length, share:included.length ? ids.length / included.length * 100 : null};
      })};
  });
}

function keyFibonacciStats(rows: readonly FibObservation[]) {
  const groups = new Map<string, {
    wave: string; degree: string; timeframe: string; measurementKind: string;
    included: FibObservation[];
  }>();
  const excluded: { id: string; reason: string }[] = [];
  for (const r of rows) {
    if (r.status !== "abgeschlossen" || r.evidence?.measurementConfidence === "unklar" || r.evidence?.keyFibLevel == null) {
      excluded.push({ id: r.id, reason: r.status !== "abgeschlossen" ? `Status ${r.status}` : r.evidence?.measurementConfidence === "unklar" ? "Messart ungeklärt" : "Schlüsselfibonacci nicht erhoben" });
      continue;
    }
    const dimensions = { wave: r.wave, degree: r.degree, timeframe: r.timeframe, measurementKind: r.measurementKind ?? "retracement" };
    const key = JSON.stringify(dimensions);
    const g = groups.get(key) ?? { ...dimensions, included: [] };
    g.included.push(r);
    groups.set(key, g);
  }
  return {
    excluded,
    groups: [...groups.values()].map(({ included, ...g }) => ({
      ...g,
      n: included.length,
      distribution: RESEARCH_LEVELS.flatMap(level => {
        const ids = included.filter(r => r.evidence!.keyFibLevel === level).map(r => r.id);
        return ids.length ? [{ level, ids, n: ids.length, share: ids.length / included.length * 100 }] : [];
      }),
    })),
  };
}
