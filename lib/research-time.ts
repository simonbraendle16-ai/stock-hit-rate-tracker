import { latestObservations, type FibObservation } from './fibonacci';
import { categoricalStats } from './fibonacci-categorical-stats';
import { historicalTime, historicalTimeError } from './fibonacci-time';
import { residenceComparisons, reversalComparisons } from './fibonacci-residence';
import { waveVariant } from './fibonacci-wave-variants';

/** Aggregate the complete selected population. No recorded-date fallback or inferred duration. */
export function researchTimeModel(selected: readonly FibObservation[]) {
  const contexts = new Map<string, {kind:string;wave:string;degree:string;timeframe:string;direction:string;hierarchy:string;basis:string;variant:string;rows:FibObservation[]}>();
  for (const r of latestObservations(selected)) {
    const dimensions = {kind:r.measurementKind ?? 'retracement',wave:r.wave,degree:r.degree,timeframe:r.timeframe,
      direction:r.evidence?.waveDirection ?? 'unbekannt',hierarchy:r.evidence?.parentId ? 'Unterwellen' : 'Hauptwellen / ohne Elternbezug',
      basis:r.measurementBasis?.trim() || 'nicht erhoben',variant:waveVariant(r.evidence?.waveVariant)?.label ?? 'Variante nicht erhoben'};
    const key=JSON.stringify(dimensions), group=contexts.get(key) ?? {...dimensions,rows:[]};
    group.rows.push(r);contexts.set(key,group);
  }
  return [...contexts.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,{rows,...context}])=>{
    const chronology=new Map<string,{label:string;n:number;ids:string[]}>();
    const missing:string[]=[];
    for(const r of rows) {
      const t=historicalTime(r);
      if(historicalTimeError(t) || !t.start) {missing.push(r.id);continue;}
      const b=t.start, label=`${b.precision === "year" ? b.date : b.date.slice(0,7)} · ${b.approximate ? 'ungefähr · ' : ''}${{day:'taggenau',month:'monatsgenau',year:'jahresgenau'}[b.precision]}`;
      const g=chronology.get(label) ?? {label,n:0,ids:[]};g.n++;g.ids.push(r.id);chronology.set(label,g);
    }
    const n=rows.length-missing.length;
    const usable=rows.filter(r=>r.evidence?.measurementConfidence !== 'unklar');
    const durations=categoricalStats(usable).durations;
    for(const r of rows.filter(r=>r.evidence?.measurementConfidence === 'unklar'))
      for(const type of ['wave','reversal','residence']) durations.excluded.push({id:r.id,type,reason:'Messart ungeklärt'});
    const exact={reversal:reversalComparisons(usable),residence:residenceComparisons(usable)};
    for(const type of ['reversal','residence'] as const) {
      exact[type].denominator=rows.length;
      for(const r of rows.filter(r=>r.evidence?.measurementConfidence==='unklar'))exact[type].excluded.push({id:r.id,reason:'Messart ungeklärt'});
    }
    return {key,...context,total:rows.length,chronology:{n,missing,distribution:[...chronology.values()].sort((a,b)=>a.label.localeCompare(b.label)).map(g=>({...g,share:g.n/n*100}))},durations,exact};
  });
}
export type ResearchTimeGroup=ReturnType<typeof researchTimeModel>[number];
