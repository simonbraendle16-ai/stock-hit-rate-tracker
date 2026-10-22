import { latestObservations, type FibObservation } from './fibonacci';
import { categoricalStats } from './fibonacci-categorical-stats';
import { waveVariant } from './fibonacci-wave-variants';

/** Full selection, never a paginated table. Reuse the established metric eligibility rules. */
export function structureModel(selected: readonly FibObservation[]) {
  const groups = new Map<string, {kind: string; degree: string; timeframe: string; direction: string; hierarchy: string; basis: string; rows: FibObservation[]}>();
  for (const r of latestObservations(selected)) {
    const dimensions = {kind:r.measurementKind ?? 'retracement',degree:r.degree,timeframe:r.timeframe,direction:r.evidence?.waveDirection ?? 'unbekannt',hierarchy:r.evidence?.parentId ? 'Unterwellen' : 'Hauptwellen / ohne Elternbezug',basis:r.measurementBasis?.trim() || 'nicht erhoben'};
    const key = JSON.stringify(dimensions), g = groups.get(key) ?? {...dimensions,rows:[]};
    g.rows.push(r); groups.set(key,g);
  }
  return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,{rows,...dimensions}])=>{
    const waves = new Map<string, {wave:string; variant:string; rows:FibObservation[]}>();
    for (const r of rows) {
      const variant = waveVariant(r.evidence?.waveVariant)?.label ?? 'Variante nicht erhoben';
      const waveKey = JSON.stringify([r.wave,variant]), w = waves.get(waveKey) ?? {wave:r.wave,variant,rows:[]};
      w.rows.push(r); waves.set(waveKey,w);
    }
    const comparisons = [...waves.entries()].sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})).map(([waveKey,{rows,wave,variant}])=>{
      const stats = categoricalStats(rows);
      const reversal = stats.reversals.groups[0];
      const patterns = ['bestaetigt','vermutet','unbekannt'].map(confidence=>{
        const subset = rows.filter(r=>(r.evidence?.structureConfidence ?? 'unbekannt') === confidence);
        const c = categoricalStats(subset);
        const n = c.structures.reduce((sum,s)=>sum+s.ids.length,0);
        return {confidence,total:subset.length,n,excluded:subset.length-n,distribution:c.structures.filter(s=>s.ids.length).map(s=>({label:s.label,n:s.ids.length,share:s.ids.length/n*100}))};
      });
      return {key:waveKey,wave,variant,total:rows.length,n:reversal?.n ?? 0,
        levels:reversal?.distribution ?? [],excluded:stats.reversals.excluded,
        patterns,subdivisions:stats.subdivisions};
    });
    const zones = [...new Set(comparisons.flatMap(w=>w.levels.map(l=>JSON.stringify(l.zone))))]
      .map(z=>JSON.parse(z) as [number,number]).sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
    return {key,...dimensions,total:rows.length,zones,waves:comparisons};
  });
}
export type StructureGroup = ReturnType<typeof structureModel>[number];
