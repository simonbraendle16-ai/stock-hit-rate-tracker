import { fibStats, latestObservations, type FibObservation } from "./fibonacci";

export function hierarchyError(rows: readonly FibObservation[], candidate: FibObservation): string | null {
  const map = new Map(latestObservations(rows).map(r=>[r.id,r]));
  map.set(candidate.id,candidate);
  // Also check descendants when moving an existing parent to another instrument.
  const affected = hierarchyIds([...map.values()],candidate.id,true);
  for (const row of map.values()) {
    if (!affected.has(row.id)) continue;
    const visited = new Set([row.id]);
    let current = row;
    while (current.evidence?.parentId) {
      const id = current.evidence.parentId;
      if (visited.has(id)) return "Wellenhierarchie enthält einen Zyklus oder Selbstbezug.";
      visited.add(id);
      const parent = map.get(id);
      if (!parent || parent.stockId !== row.stockId) return "Elternwelle fehlt oder gehört zu einem anderen Instrument/Eigentümer.";
      current = parent;
    }
  }
  return null;
}
export function hierarchyIds(rows: readonly FibObservation[], root: string, descendants = false) {
  const ids = new Set(rows.some(r=>r.id === root) ? [root] : []);
  if (descendants) {
    let changed = true;
    while (changed) { changed = false; for (const r of rows) if (r.evidence?.parentId && ids.has(r.evidence.parentId) && !ids.has(r.id)) {ids.add(r.id);changed=true;} }
  }
  return ids;
}
export function hierarchyGroups(rows: readonly FibObservation[]) {
  const selected = latestObservations(rows);
  return [false,true].map(child=>{
    const items = selected.filter(r=>Boolean(r.evidence?.parentId) === child);
    return {role:child ? "subwaves" : "main",ids:items.map(r=>r.id),n:items.length,statsByKind:{retracement:fibStats(items,"retracement"),expansion:fibStats(items,"expansion")}};
  });
}
