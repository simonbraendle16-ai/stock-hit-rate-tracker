import type { FibFilters, FibObservation } from "./fibonacci";

export type TimeBoundary = { precision: "day" | "month" | "year"; date: string; approximate?: boolean; earliest?: string; latest?: string };
export type HistoricalTime = { start: TimeBoundary | null; end: TimeBoundary | null; source?: string };
export type TimeMatch = "certain" | "possible" | "unknown" | "excluded";
const invalid = (): never => { throw new Error("Ungültige historische Zeitangabe."); };

/** Calendar envelopes are computation bounds, never asserted observation dates. */
export function dateEnvelope(date: string): [string, string] {
  if (typeof date !== "string" || !/^\d{4}(-\d{2})?(-\d{2})?$/.test(date)) return invalid();
  const y = Number(date.slice(0,4)), m = date.length >= 7 ? Number(date.slice(5,7)) : 1;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31];
  const d = date.length === 10 ? Number(date.slice(8)) : 1;
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > days[m-1]) return invalid();
  return date.length === 4 ? [date+"-01-01",date+"-12-31"] : date.length === 7 ? [date+"-01",date+"-"+days[m-1]] : [date,date];
}
export function boundaryEnvelope(b: TimeBoundary | null): [string | null, string | null] {
  if (b == null) return [null,null];
  if (typeof b !== "object" || Array.isArray(b) || Object.keys(b).some(k=>!["precision","date","approximate","earliest","latest"].includes(k))) return invalid();
  if (!({day:10,month:7,year:4}[b.precision] === b.date?.length)) return invalid();
  const [lo,hi] = dateEnvelope(b.date);
  if (b.approximate !== undefined && typeof b.approximate !== "boolean") return invalid();
  if (!b.approximate && (b.earliest !== undefined || b.latest !== undefined)) return invalid();
  if (b.earliest !== undefined && (b.earliest.length !== 10 || dateEnvelope(b.earliest)[0] > lo)) return invalid();
  if (b.latest !== undefined && (b.latest.length !== 10 || dateEnvelope(b.latest)[1] < hi)) return invalid();
  return b.approximate ? [b.earliest ?? null,b.latest ?? null] : [lo,hi];
}
export function historicalTimeError(value: unknown): string | null {
  if (value == null) return null;
  try {
    if (typeof value !== "object" || Array.isArray(value)) return invalid();
    const t = value as HistoricalTime;
    if (Object.keys(t).some(k=>!["start","end","source"].includes(k)) || !("start" in t) || !("end" in t)) return invalid();
    if (t.source !== undefined && (typeof t.source !== "string" || !t.source.trim() || t.source.length > 2000)) return invalid();
    const s = boundaryEnvelope(t.start), e = boundaryEnvelope(t.end);
    if (s[0] && e[1] && s[0] > e[1]) return invalid();
    // Even unbounded approximate claims cannot have a nominally reversed order.
    if (t.start && t.end && dateEnvelope(t.start.date)[0] > dateEnvelope(t.end.date)[1]) return invalid();
    return null;
  } catch { return "Ungültige historische Zeitangabe: Genauigkeit, Kalenderdatum und Reihenfolge prüfen."; }
}
export function historicalTime(row: FibObservation): HistoricalTime {
  if (row.evidence?.historicalTime != null) return row.evidence.historicalTime;
  return { start: row.periodFrom ? {precision:"day",date:row.periodFrom} : null, end: row.periodTo ? {precision:"day",date:row.periodTo} : null };
}
export function timeMatch(row: FibObservation, filters: FibFilters): TimeMatch {
  if (!filters.from && !filters.to) return "certain";
  const lo = filters.from ? dateEnvelope(filters.from)[0] : "0001-01-01";
  const hi = filters.to ? dateEnvelope(filters.to)[1] : "9999-12-31";
  if (lo > hi) throw new Error("Zeitraum ist umgekehrt.");
  if (filters.timeBasis === "recorded") return row.observedOn >= lo && row.observedOn <= hi ? "certain" : "excluded";
  const t = historicalTime(row), s = boundaryEnvelope(t.start), e = boundaryEnvelope(t.end);
  if ((s[0] && s[0] > hi) || (e[1] && e[1] < lo)) return "excluded";
  // One documented endpoint inside the query already proves overlap.
  if ((s[0] && s[1] && s[0] >= lo && s[1] <= hi) || (e[0] && e[1] && e[0] >= lo && e[1] <= hi)) return "certain";
  if (s[1] && e[0] && s[1] <= hi && e[0] >= lo) return "certain";
  if (!s[0] || !s[1] || !e[0] || !e[1]) return "unknown";
  return "possible";
}
export function timeLabel(row: FibObservation) {
  const t = historicalTime(row);
  const label = (b: TimeBoundary | null) => b ? `${b.approximate ? "ca. " : ""}${b.date}${b.earliest || b.latest ? ` (${b.earliest ?? "offen"}–${b.latest ?? "offen"})` : ""}` : "unbekannt";
  return `${label(t.start)} bis ${label(t.end)}`;
}

export function timeFilterError(filters: FibFilters): string | null {
  try {
    const lo = filters.from ? dateEnvelope(filters.from)[0] : "0001-01-01";
    const hi = filters.to ? dateEnvelope(filters.to)[1] : "9999-12-31";
    return lo > hi ? "Zeitraum ist umgekehrt." : null;
  } catch { return "Zeitraum als JJJJ, JJJJ-MM oder JJJJ-MM-TT vollständig eingeben."; }
}
