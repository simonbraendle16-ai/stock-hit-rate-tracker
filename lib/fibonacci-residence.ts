import { residenceConflict } from "./fibonacci-duration-compatibility";
import type { FibObservation } from "./fibonacci";

export type TargetZoneResidence = {
  kind: "unknown" | "exact" | "approximate" | "range" | "upper_bound";
  touchAndGo: boolean | null;
  value?: number;
  lower?: number;
  upper?: number;
  lowerInclusive?: boolean;
  upperInclusive?: boolean;
  unit: "minute" | "hour" | "day";
  timeBasis: "unknown" | "calendar" | "trading";
  measurementConvention: string | null;
  zone: [number, number];
  originalText: string | null;
};

export function residenceError(value: unknown): string | null {
  const error = "Ungültige Zielzonen-Verweildauer: Art, Werte, Einheit und Zonenbezug prüfen.";
  if (!value || typeof value !== "object" || Array.isArray(value)) return error;
  const r = value as Record<string, unknown>;
  const keys = ["kind", "touchAndGo", "value", "lower", "upper", "lowerInclusive", "upperInclusive", "unit", "timeBasis", "measurementConvention", "zone", "originalText"];
  if (Object.keys(r).some(k => !keys.includes(k))) return error;
  if (typeof r.kind !== "string" || typeof r.unit !== "string" || typeof r.timeBasis !== "string" ||
      !["unknown", "exact", "approximate", "range", "upper_bound"].includes(r.kind) ||
      !["minute", "hour", "day"].includes(String(r.unit)) ||
      !["unknown", "calendar", "trading"].includes(String(r.timeBasis)) ||
      !(r.touchAndGo === null || typeof r.touchAndGo === "boolean")) return error;
  const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
  const nonnegative = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (!Array.isArray(r.zone) || r.zone.length !== 2 || !r.zone.every(nonnegative) || r.zone[0] > r.zone[1]) return error;
  for (const key of ["originalText", "measurementConvention"]) {
    if (r[key] !== null && (typeof r[key] !== "string" || !r[key].trim() || r[key].length > 2000)) return error;
  }
  const allowed = r.kind === "range" ? ["lower", "upper", "lowerInclusive", "upperInclusive"] :
    r.kind === "upper_bound" ? ["upper", "upperInclusive"] :
    r.kind === "unknown" ? [] : ["value"];
  if (["value", "lower", "upper", "lowerInclusive", "upperInclusive"].some(k => k in r && !allowed.includes(k))) return error;
  if ((r.kind === "exact" || r.kind === "approximate") && !positive(r.value)) return error;
  if ((r.kind === "upper_bound" || r.kind === "range") && (!positive(r.upper) || typeof r.upperInclusive !== "boolean")) return error;
  if (r.kind === "range" && (!nonnegative(r.lower) || typeof r.lowerInclusive !== "boolean" || r.lower >= (r.upper as number))) return error;
  return null;
}

export const residenceKindLabels = { unknown: "Dauer unbekannt", exact: "Exakt berichtet", approximate: "Ungefähr", range: "Bereich", upper_bound: "Obergrenze" };
export function residenceLabel(r?: TargetZoneResidence | null): string {
  if (!r) return "Nicht erhoben";
  const unit = (n?: number) => n === 1 ? {minute:"Minute",hour:"Stunde",day:"Tag"}[r.unit] : {minute:"Minuten",hour:"Stunden",day:"Tage"}[r.unit];
  const duration = r.kind === "unknown" ? "Dauer unbekannt" : r.kind === "upper_bound" ? `${r.upperInclusive ? "bis einschließlich" : "unter"} ${r.upper ?? "…"} ${unit(r.upper)}` :
    r.kind === "range" ? `${r.lowerInclusive ? "ab" : "mehr als"} ${r.lower ?? "…"} bis ${r.upperInclusive ? "einschließlich" : "unter"} ${r.upper ?? "…"} ${unit(r.upper)}` : `${r.kind === "approximate" ? "ca. " : ""}${r.value ?? "…"} ${unit(r.value)}`;
  const zone = r.zone.every(Number.isFinite) ? `Zone ${r.zone.join("–")} %` : "Zielzone ergänzen";
  return `${r.touchAndGo === true ? "Touch-and-Go" : r.touchAndGo === false ? "Länger verweilt" : "Verhalten unbekannt"} · ${duration} · ${zone}`;
}

/** Exact averages are grouped by explicit time basis and convention; never fill gaps. */
export function residenceComparisons(rows: readonly FibObservation[]) {
  const excluded: {id: string; reason: string}[] = [];
  const groups = new Map<string, {wave:string;degree:string;timeframe:string;measurementKind:string;zone:[number,number];timeBasis: string; convention: string; unit: TargetZoneResidence["unit"]; included: {id: string; value: number}[]}>();
  for (const row of rows) {
    const r = row.evidence?.targetZoneResidence;
    const reason = residenceConflict(row.evidence) ?? (row.evidence?.targetContact === "not_reached" ? "Zielzone nicht erreicht" : row.status !== "abgeschlossen" ? `Status ${row.status}` : !r ? "Nicht erhoben" :
      r.kind !== "exact" ? `Keine exakte Dauer: ${residenceKindLabels[r.kind]}` :
      r.timeBasis === "unknown" || !r.measurementConvention ? "Zeitbasis oder Messkonvention offen" : null);
    if (reason || !r) { excluded.push({id: row.id, reason: reason!}); continue; }
    // A trading day has no assumed hour count. Keep trading units separate.
    const unit = r.timeBasis === "calendar" ? "hour" : r.unit;
    const value = r.value! * (r.timeBasis === "calendar" ? {minute: 1 / 60, hour: 1, day: 24}[r.unit] : 1);
    if (!Number.isFinite(value) || value <= 0) { excluded.push({id:row.id,reason:"Dauer nicht verlustfrei normalisierbar"}); continue; }
    const dimensions = {wave:row.wave,degree:row.degree,timeframe:row.timeframe,measurementKind:row.measurementKind ?? "retracement",zone:r.zone};
    const key = JSON.stringify([dimensions, r.timeBasis, r.measurementConvention, unit]);
    const group = groups.get(key) ?? {...dimensions,timeBasis: r.timeBasis, convention: r.measurementConvention!, unit, included: []};
    group.included.push({id: row.id, value});
    groups.set(key, group);
  }
  return {denominator: rows.length, excluded, groups: [...groups.values()].map(g => {
    const values = g.included.map(v => v.value).sort((a,b) => a-b);
    const mid = Math.floor(values.length / 2);
    return {...g, n: values.length, average: values.reduce((a,b) => a+b / values.length,0),
      median: values.length % 2 ? values[mid] : values[mid-1] / 2 + values[mid] / 2};
  })};
}
