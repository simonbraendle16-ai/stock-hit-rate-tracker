import { fibStats, type FibObservation } from './fibonacci';

/** Adapt the existing full-selection aggregators once, shared by presentation modules.
 * Never pass a table page here. Missing kind on historical records means retracement.
 */
export function panoramaModel(selected: readonly FibObservation[], kind?: 'retracement' | 'expansion') {
  const kinds = kind ? [kind] : ['retracement', 'expansion'] as const;
  return kinds.map(measurementKind => {
    const stats = fibStats(selected, measurementKind);
    const c = stats.categorical;
    const knownStructures = new Set(c.structureFamilies.flatMap(g => g.ids));
    return {
      kind: measurementKind,
      total: stats.coverage.total,
      completed: stats.coverage.completed,
      categorical: c,
      structures: {
        n: knownStructures.size,
        excluded: stats.coverage.total - knownStructures.size,
        distribution: c.structureFamilies.map(g => ({
          label: g.parent, n: g.ids.length,
          share: knownStructures.size ? g.ids.length / knownStructures.size * 100 : null,
        })),
      },
    };
  });
}
export type PanoramaGroup = ReturnType<typeof panoramaModel>[number];
