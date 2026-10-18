import { RESEARCH_LEVELS } from "./fibonacci-catalogue";
import { latestObservations, type FibObservation } from "./fibonacci";

export const LEVEL_MEANINGS = ["end", "reversal", "target", "passed"] as const;
export type LevelMeaning = (typeof LEVEL_MEANINGS)[number];
export type LevelSearch = {
  levelFrom?: number;
  levelTo?: number;
  levelMeaning?: LevelMeaning;
};
export const levelMeaningLabels: Record<LevelMeaning, string> = {
  end: "Wellenendlevel + passende Umkehrzonen",
  reversal: "Beobachtete Umkehrzone",
  target: "Dokumentierte Zielzone",
  passed: "Erreichtes / durchlaufenes Level",
};
export function levelSearchError(q: LevelSearch) {
  const active =
    q.levelFrom !== undefined ||
    q.levelTo !== undefined ||
    q.levelMeaning !== undefined;
  if (!active) return null;
  if (
    !LEVEL_MEANINGS.includes(q.levelMeaning!) ||
    !RESEARCH_LEVELS.includes(q.levelFrom!) ||
    (q.levelTo !== undefined &&
      (!RESEARCH_LEVELS.includes(q.levelTo) || q.levelTo < q.levelFrom!))
  )
    return "Levelbedeutung und gültige Fibonacci-Grenzen auswählen.";
  return null;
}
/** No tolerance, rounding, note mining or inference from a maximum/hypothetical exit. */
export function levelMatchGroups(
  row: FibObservation,
  q: LevelSearch,
): string[] {
  if (
    levelSearchError(q) ||
    q.levelFrom === undefined ||
    row.status === "ungueltig"
  )
    return [];
  const lo = q.levelFrom,
    hi = q.levelTo ?? lo,
    e = row.evidence;
  const overlaps = (z?: [number, number] | null) =>
    !!z && z[0] <= hi && z[1] >= lo;
  const within = (n: number) => n >= lo && n <= hi;
  if (q.levelMeaning === "target")
    return overlaps(e?.targetZone) ? ["targetZones"] : [];
  if (q.levelMeaning === "passed")
    return (e?.reachedLevels ?? []).some(within) ? ["passedLevels"] : [];
  if (q.levelMeaning === "reversal")
    return overlaps(e?.reversalZone) ? ["observedReversals"] : [];
  if (row.status !== "abgeschlossen" || !overlaps(e?.reversalZone)) return [];
  const z = e!.reversalZone!;
  if (e?.reversalLocation === "between_levels" && z[0] < z[1])
    return ["reversalZones"];
  if (e?.reversalLocation !== "at_level" || z[0] !== z[1]) return [];
  if (e.catalogueVersion === 1) return ["catalogueEndLevels"];
  // Historical explicitly located reversals retain their reported precision.
  if (e.measurementConfidence === "unklar") return [];
  return [
    e.reversalPrecision === "approximate"
      ? "historicalApproximate"
      : e.reversalPrecision === "exact"
        ? "historicalExact"
        : "historicalUnspecified",
  ];
}
export const levelGroupLabels: Record<string, string> = {
  catalogueEndLevels: "Abgeschlossene Umkehr am Kataloglevel",
  historicalExact: "Historische exakt dokumentierte Endlage",
  historicalApproximate: "Historische ungefähre Endlage (ohne Toleranz)",
  historicalUnspecified: "Historische Endlage ohne dokumentierte Genauigkeit",
  reversalZones: "Zusätzlich passende abgeschlossene Umkehrzonen",
  observedReversals: "Beobachtete Umkehrzonen (Status separat)",
  targetZones: "Dokumentierte Zielzonen",
  passedLevels: "Erreichte / durchlaufene Levels",
};
export function levelSearchGroups(
  rows: readonly FibObservation[],
  q: LevelSearch,
) {
  const groups = Object.fromEntries(
    Object.keys(levelGroupLabels).map((k) => [k, [] as string[]]),
  );
  const ids = new Set<string>();
  for (const row of latestObservations(rows))
    for (const key of levelMatchGroups(row, q)) {
      if (!groups[key].includes(row.id)) groups[key].push(row.id);
      ids.add(row.id);
    }
  return {
    groups,
    ids: [...ids].sort(),
    total: ids.size,
    error: levelSearchError(q),
  };
}
