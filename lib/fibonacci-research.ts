import { fibCsv, fibStats, type FibObservation } from './fibonacci';
import { interpretFibSearch, type SearchInstrument } from './fibonacci-search';
import { levelSearchError, levelSearchGroups } from './fibonacci-level-search';
import { timeFilterError } from './fibonacci-time';
import { orderResearchRows, researchTimeGroups, selectResearchRows } from './fibonacci-workspace';
import type { ResearchQuery } from './fibonacci-query-values';

/** Full owned population first; presentation order and page never change statistics. */
export function researchResult(rows: readonly FibObservation[], instruments: readonly SearchInstrument[], request: ResearchQuery) {
  const interpretation = request.query.trim()
    ? interpretFibSearch(request.query, instruments, request.filters, request.resolutions)
    : null;
  const filters = interpretation?.filters ?? request.filters;
  const error = levelSearchError(filters) ?? timeFilterError(filters);
  const ready = !error && (!interpretation || interpretation.ready);
  const selected = ready ? selectResearchRows(rows, filters, request.search, request.selection) : [];
  const ordered = orderResearchRows(selected, request.order);
  return {
    ready, error, interpretation, filters, selected, ordered,
    items: ordered.slice(request.offset, request.offset + request.limit),
    total: ready ? selected.length : null,
    nextOffset: ready && request.offset + request.limit < selected.length ? request.offset + request.limit : null,
    stats: ready ? fibStats(selected, filters.measurementKind) : null,
    levelSelection: ready ? levelSearchGroups(selected, filters) : null,
    timeSelection: ready ? researchTimeGroups(rows, filters, request.search, request.selection) : null,
  };
}

export function researchCsv(result: ReturnType<typeof researchResult>) {
  if (!result.ready) throw new Error('Suchkriterien vor dem Export vollständig klären.');
  return fibCsv(result.ordered);
}
