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
  const words = searchable(search.trim()).split(/\s+/).filter(Boolean);
  return filterFib(latestObservations(rows), filters).filter((row) => {
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
