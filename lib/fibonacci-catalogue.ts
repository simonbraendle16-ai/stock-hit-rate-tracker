import { ZONE_TO_PIVOT } from "./fibonacci-duration-definitions";
/** Versioned categorical research inputs. Never round a reported measurement. */
export const RESEARCH_LEVELS = [
  0,
  100,
  200,
  300,
  ...[0, 100, 200, 300].flatMap((n) =>
    [23.6, 38.2, 50, 61.8, 78.6, 88.7].map(
      (v) => Math.round((n + v) * 10) / 10,
    ),
  ),
].sort((a, b) => a - b);
export const RESEARCH_WAVES = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "A",
  "B",
  "C",
  "D",
  "E",
  "W",
  "X",
  "Y",
  "Z",
  "X₂",
];
export const STRUCTURES = [
  ["unknown", "Unbekannt", "unknown"],
  ["impulse", "Impuls", "impulse"],
  ["diagonal", "Diagonal · Untertyp offen", "diagonal"],
  ["diagonal_leading", "Diagonal · führend", "diagonal"],
  ["diagonal_ending", "Diagonal · abschließend", "diagonal"],
  ["abc", "ABC · unbestimmt", "abc"],
  ["abc_zigzag", "ABC · Zigzag", "abc"],
  ["abc_flat", "ABC-Flat · Untertyp offen", "abc_flat"],
  ["flat_regular", "ABC-Flat · regulär", "abc_flat"],
  ["flat_expanded", "ABC-Flat · Expanded", "abc_flat"],
  ["flat_running", "ABC-Flat · Running", "abc_flat"],
  ["triangle", "Dreieck · Untertyp offen", "triangle"],
  ["triangle_contracting", "Dreieck · kontrahierend", "triangle"],
  ["triangle_expanding", "Dreieck · expandierend", "triangle"],
  ["wxy", "WXY", "wxy"],
  ["wxyxz", "WXYXZ", "wxyxz"],
] as const;
export type StructureCode = (typeof STRUCTURES)[number][0];
export function structureCode(text?: string | null): StructureCode | null {
  if (!text) return null;
  const s = text.trim().toLowerCase().replaceAll(/\s/g, "");
  const aliases: Record<string, StructureCode> = {
    impuls: "impulse",
    abc: "abc",
    flat: "abc_flat",
    "abc-flat": "abc_flat",
    dreieck: "triangle",
    diagonal: "diagonal",
    wxy: "wxy",
    wxyxz: "wxyxz",
  };
  return (
    STRUCTURES.find(
      ([code, label]) =>
        code === s || label.toLowerCase().replaceAll(/\s/g, "") === s,
    )?.[0] ??
    aliases[s] ??
    null
  );
}
export const DURATION_CLASSES = [
  ["lt_1h", "Unter 1 Stunde", 0, 1],
  ["h1_4", "1–4 Stunden", 1, 4],
  ["h4_12", "4–12 Stunden", 4, 12],
  ["h12_24", "12–24 Stunden", 12, 24],
  ["d1_3", "1–3 Tage", 24, 72],
  ["d3_7", "3–7 Tage", 72, 168],
  ["d7_30", "7–30 Tage", 168, 720],
  ["d30_90", "30–90 Tage", 720, 2160],
  ["d90_180", "90–180 Tage", 2160, 4320],
  ["d180_365", "180–365 Tage", 4320, 8760],
  ["ge_365d", "Ab 365 Tagen", 8760, Infinity],
] as const;
export type DurationClass = (typeof DURATION_CLASSES)[number][0];
export type ClassifiedDuration = {
  zone?: [number, number];
  bucket: DurationClass | "unknown";
  timeBasis: "calendar" | "trading" | "unknown";
  convention:
    | "first_visit"
    | "total_visits"
    | "whole_wave"
    | "reversal"
    | "first_entry_to_pivot"
    | "unknown";
};
export type ResearchEvidence = {
  keyFibLevel?: number | null;
  catalogueVersion?: 1;
  structureCode?: StructureCode | null;
  entryZone?: [number, number] | null;
  targetContact?: "reached" | "not_reached" | "unknown";
  expectationTiming?: "prior" | "retrospective" | "unknown";
  reversalLocation?: "at_level" | "between_levels" | "unknown";
  /** Optional precision of an explicitly documented historical reversal, never of a maximum. */
  reversalPrecision?: "exact" | "approximate" | "unknown";
  durations?: {
    wave?: ClassifiedDuration | null;
    reversal?: ClassifiedDuration | null;
    residence?: ClassifiedDuration | null;
  } | null;
};
export const RESEARCH_EVIDENCE_KEYS = [
  "keyFibLevel",
  "catalogueVersion",
  "structureCode",
  "entryZone",
  "targetContact",
  "expectationTiming",
  "reversalLocation",
  "reversalPrecision",
  "durations",
];
export function researchEvidenceError(
  e: Record<string, unknown>,
): string | null {
  if (e.keyFibLevel != null) {
    if (typeof e.keyFibLevel !== "number" || !RESEARCH_LEVELS.includes(e.keyFibLevel))
      return "Schlüsselfibonacci aus den Fibonacci-Levels auswählen.";
    const level = e.keyFibLevel;
    if (Array.isArray(e.missedLevels) && e.missedLevels.some(m => m <= level))
      return "Schlüsselfibonacci widerspricht den verfehlten Levels.";
    const z = e.reversalZone;
    if (Array.isArray(z) && (level > z[1] ||
      (e.reversalLocation === "between_levels" && level === z[1])))
      return "Schlüsselfibonacci wurde vor dem angegebenen Umkehrbereich nicht erreicht.";
    if (e.targetContact === "not_reached" && Array.isArray(e.targetZone) &&
      level >= e.targetZone[0] && level <= e.targetZone[1])
      return "Schlüsselfibonacci liegt in der als unerreicht markierten Zielzone.";
  }
  if (e.catalogueVersion !== undefined && e.catalogueVersion !== 1)
    return "Unbekannte Auswahlversion.";
  if (
    e.structureCode != null &&
    !STRUCTURES.some(([v]) => v === e.structureCode)
  )
    return "Ungültige Wellenstruktur.";
  for (const [key, values] of Object.entries({
    targetContact: ["reached", "not_reached", "unknown"],
    expectationTiming: ["prior", "retrospective", "unknown"],
    reversalLocation: ["at_level", "between_levels", "unknown"],
    reversalPrecision: ["exact", "approximate", "unknown"],
  })) {
    if (
      e[key] !== undefined &&
      (typeof e[key] !== "string" || !values.includes(e[key] as string))
    )
      return `Ungültige Auswahl: ${key}.`;
  }
  if (
    e.entryZone != null &&
    (!Array.isArray(e.entryZone) ||
      e.entryZone.length !== 2 ||
      !e.entryZone.every(
        (n) => typeof n === "number" && Number.isFinite(n) && n >= 0,
      ) ||
      e.entryZone[0] > e.entryZone[1])
  )
    return "Ung?ltige Einstiegszone.";
  if (e.durations != null) {
    if (typeof e.durations !== "object" || Array.isArray(e.durations))
      return "Ungültige Dauerklassen.";
    for (const [key, v] of Object.entries(e.durations)) {
      if (!["wave", "reversal", "residence"].includes(key))
        return "Unbekannte Dauerart.";
      if (v == null) continue;
      if (
        typeof v !== "object" ||
        Array.isArray(v) ||
        Object.keys(v).some(
          (k) => !["bucket", "timeBasis", "convention", "zone"].includes(k),
        )
      )
        return "Ungültige Dauerklasse.";
      const d = v as ClassifiedDuration;
      if (key === "reversal" && d.convention === ZONE_TO_PIVOT && d.timeBasis !== "calendar") return "Die Dauer bis zum Wellenwendepunkt wird in Kalenderzeit erfasst.";
      if (
        (key === "residence" || (key === "reversal" && d.convention === ZONE_TO_PIVOT)) &&
        (!Array.isArray(d.zone) ||
          d.zone.length !== 2 ||
          !d.zone.every((n) => RESEARCH_LEVELS.includes(n)) ||
          d.zone[0] > d.zone[1])
      )
        return "Fibonacci-Zonenbezug der Aufenthaltsdauer fehlt.";
      if (
        !(
          d.bucket === "unknown" ||
          DURATION_CLASSES.some(([id]) => id === d.bucket)
        ) ||
        !["calendar", "trading", "unknown"].includes(d.timeBasis) ||
        ![
          "first_visit",
          "total_visits",
          "whole_wave",
          "reversal",
          ZONE_TO_PIVOT,
          "unknown",
        ].includes(d.convention)
      )
        return "Ungültige Dauerklasse, Zeitbasis oder Messweise.";
      if (
        (key === "wave" && !["whole_wave", "unknown"].includes(d.convention)) ||
        (key === "reversal" &&
          !["reversal", ZONE_TO_PIVOT, "unknown"].includes(d.convention)) ||
        (key === "residence" &&
          !["first_visit", "total_visits", "unknown"].includes(d.convention))
      )
        return "Messweise passt nicht zur Dauerart.";
    }
  }
  if (
    e.targetContact === "not_reached" &&
    ((e.durations as ResearchEvidence["durations"])?.residence ||
      (e.durations as ResearchEvidence["durations"])?.reversal?.convention === ZONE_TO_PIVOT ||
      e.targetZoneResidence || e.targetZoneReversal)
  )
    return "Unerreichte Zielzone hat keine Aufenthaltsdauer oder Dauer bis zum Wellenwendepunkt.";
  if (e.catalogueVersion === 1) {
    for (const key of ["reachedLevels", "missedLevels"])
      if (
        Array.isArray(e[key]) &&
        !(e[key] as number[]).every((v) => RESEARCH_LEVELS.includes(v))
      )
        return "Nur auswählbare Fibonacci-Levels verwenden.";
    for (const key of ["targetZone", "entryZone", "reversalZone"]) {
      const z = e[key];
      if (
        z != null &&
        (!Array.isArray(z) ||
          z.length !== 2 ||
          !z.every((v) => RESEARCH_LEVELS.includes(v)) ||
          z[0] > z[1])
      )
        return "Zonengrenzen aus den Fibonacci-Levels auswählen.";
    }
    const z = e.reversalZone as number[] | null;
    if (e.reversalLocation === "at_level" && (!z || z[0] !== z[1]))
      return "Umkehr am Level benötigt ein einzelnes Level.";
    if (
      e.reversalLocation === "at_level" &&
      z &&
      Array.isArray(e.missedLevels) &&
      e.missedLevels.some((m) => m <= z[0])
    )
      return "Umkehrlevel widerspricht den verfehlten Levels.";
    if (e.reversalLocation === "between_levels" && (!z || z[0] >= z[1]))
      return "Umkehr zwischen Levels benötigt zwei verschiedene Grenzen.";
    if (z && (!e.reversalLocation || e.reversalLocation === "unknown"))
      return "Art der beobachteten Umkehr auswählen.";
    if (e.targetContact === "not_reached" && Array.isArray(e.targetZone)) {
      const [lo, hi] = e.targetZone as number[];
      if (
        Array.isArray(e.reachedLevels) &&
        e.reachedLevels.some((v) => v >= lo && v <= hi)
      )
        return "Erreichtes Level liegt in der als unerreicht markierten Zielzone.";
      if (z && z[0] >= lo && z[1] <= hi)
        return "Umkehr liegt in der als unerreicht markierten Zielzone.";
    }
  }
  return null;
}
