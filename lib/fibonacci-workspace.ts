import { hierarchyIds } from "./fibonacci-hierarchy";
import { timeMatch, timeFilterError } from "./fibonacci-time";
import { filterFib, latestObservations, type FibFilters, type FibObservation } from "./fibonacci";

export type ResearchSelection = "all" | "missing" | "running" | "completed";
export type ResearchOrder = "newest" | "oldest" | "deepest";
const searchable = (value: string) =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("de-DE");

/** One population for the protocol, statistics and export. Ordering is separate. */
export function selectResearchRows(
  rows: readonly FibObservation[],
  filters: FibFilters,
  search = "",
  selection: ResearchSelection = "all",
) {
  if (timeFilterError(filters)) return [];
  const words = searchable(search.trim()).split(/\s+/).filter(Boolean);
  const latest = latestObservations(rows);
  const waveIds = filters.wave && filters.waveLabelScope === "descendants" ? new Set(latest.filter(r=>r.wave.trim().toUpperCase() === filters.wave!.trim().toUpperCase()).flatMap(r=>[...hierarchyIds(latest,r.id,true)])) : null;
  const ids = filters.observationId ? hierarchyIds(latest,filters.observationId,filters.waveScope === "descendants") : null;
  return filterFib(latest, waveIds ? {...filters,wave:undefined} : filters).filter((row) => {
    if (waveIds && !waveIds.has(row.id)) return false;
    if (ids && !ids.has(row.id)) return false;
    if (filters.hierarchyRole && (Boolean(row.evidence?.parentId) !== (filters.hierarchyRole === "subwaves"))) return false;
    if (selection === "missing" && row.percent != null) return false;
    if (selection === "running" && row.status !== "laufend") return false;
    if (selection === "completed" && row.status !== "abgeschlossen")
      return false;
    const text = searchable(
      [
        row.ticker,
        row.name,
        row.wave,
        row.degree,
        row.timeframe,
        row.observedOn,
        row.periodFrom,
        row.periodTo,
        row.note,
        row.sourceRef,
        row.sourceKey,
        row.structure,
        row.measurementBasis,
        JSON.stringify(row.evidence ?? {}),
      ]
        .filter(Boolean)
        .join(" "),
    );
    return words.every((word) => text.includes(word));
  });
}

export function orderResearchRows(
  rows: readonly FibObservation[],
  order: ResearchOrder,
) {
  return [...rows].sort((a, b) => {
    if (order === "deepest" && a.percent !== b.percent) {
      if (a.percent == null) return 1;
      if (b.percent == null) return -1;
      return b.percent - a.percent;
    }
    const date = a.observedOn.localeCompare(b.observedOn);
    return (order === "oldest" ? date : -date) || a.id.localeCompare(b.id);
  });
}

export function formatResearchPercent(value: number | null | undefined) {
  return value == null
    ? "—"
    : value.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " %";
}

/** Same non-time selection and full population for every time group, before pagination. */
export function researchTimeGroups(rows: readonly FibObservation[], filters: FibFilters, search = "", selection: ResearchSelection = "all") {
  const population = selectResearchRows(rows,{...filters,from:undefined,to:undefined},search,selection);
  const groups: Record<"certain"|"possible"|"unknown"|"excluded",string[]> = {certain:[],possible:[],unknown:[],excluded:[]};
  const error = timeFilterError(filters);
  if (!error) for (const row of population) groups[timeMatch(row,filters)].push(row.id);
  for (const ids of Object.values(groups)) ids.sort();
  return {error,basis:filters.timeBasis ?? "historical",selected:filters.timeMatch ?? "certain",denominator:population.length,groups};
}
