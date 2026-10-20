import type { FibObservation } from './fibonacci';
import { STRUCTURES, structureCode } from './fibonacci-catalogue';

/** Analyst observations only. Never inferred from a pattern, parent or price. */
export const SUBDIVISIONS = [
  {code:'three_part',label:'Dreiteilig'},
  {code:'five_part',label:'Fünfteilig'},
  {code:'unknown',label:'Unbekannt'},
] as const;
export const SUBDIVISION_CONFIDENCES = [
  {code:'bestaetigt',label:'Bestätigt'},
  {code:'vermutet',label:'Vermutet'},
  {code:'unbekannt',label:'Unbekannt'},
] as const;
export type Subdivision = typeof SUBDIVISIONS[number]['code'];
export type SubdivisionConfidence = typeof SUBDIVISION_CONFIDENCES[number]['code'];
export const subdivisionLabel = (value: unknown) => SUBDIVISIONS.find(v=>v.code===value)?.label ?? 'Nicht erhoben';
export const subdivisionConfidenceLabel = (value: unknown) => SUBDIVISION_CONFIDENCES.find(v=>v.code===value)?.label ?? 'Unbekannt';

export function subdivisionError(e: Record<string,unknown>) {
  if(e.subdivision != null && !SUBDIVISIONS.some(v=>v.code===e.subdivision)) return 'Ungültige innere Unterteilung.';
  if(e.subdivisionConfidence != null && !SUBDIVISION_CONFIDENCES.some(v=>v.code===e.subdivisionConfidence)) return 'Ungültige Sicherheit der Unterteilung.';
  return null;
}

export function subdivisionStats(rows: readonly FibObservation[]) {
  const groups = new Map<string,{wave:string;degree:string;timeframe:string;measurementKind:string;pattern:string;patternConfidence:string;rows:FibObservation[]}>();
  for(const r of rows) {
    const dimensions = {wave:r.wave,degree:r.degree,timeframe:r.timeframe,measurementKind:r.measurementKind ?? 'retracement',pattern:r.evidence?.structureCode ?? structureCode(r.structure) ?? 'unknown',patternConfidence:r.evidence?.structureConfidence ?? 'unbekannt'};
    const key=JSON.stringify(dimensions),g=groups.get(key) ?? {...dimensions,rows:[]};
    g.rows.push(r);groups.set(key,g);
  }
  return [...groups.values()].map(({rows,...dimensions})=>{
    const reason = (r:FibObservation) => r.status!=='abgeschlossen' ? `Status ${r.status}` : !r.evidence?.subdivision || r.evidence.subdivision==='unknown' ? 'Unterteilung nicht erhoben oder unbekannt' : r.evidence.subdivisionConfidence!=='bestaetigt' ? 'Unterteilung nicht bestätigt' : null;
    const included=rows.filter(r=>!reason(r));
    return {...dimensions,patternLabel:STRUCTURES.find(([code])=>code===dimensions.pattern)?.[1] ?? dimensions.pattern,
      denominator:rows.length,n:included.length,ids:included.map(r=>r.id),
      excluded:rows.filter(r=>reason(r)).map(r=>({id:r.id,reason:reason(r)!})),
      provisional:rows.filter(r=>r.status==='laufend').map(r=>({id:r.id,subdivision:r.evidence?.subdivision ?? 'unknown',confidence:r.evidence?.subdivisionConfidence ?? 'unbekannt'})),
      uncertain:rows.filter(r=>r.status==='abgeschlossen' && reason(r)).map(r=>({id:r.id,subdivision:r.evidence?.subdivision ?? 'unknown',confidence:r.evidence?.subdivisionConfidence ?? 'unbekannt'})),
      distribution:SUBDIVISIONS.filter(v=>v.code!=='unknown').map(v=>{
        const ids=included.filter(r=>r.evidence?.subdivision===v.code).map(r=>r.id);
        return {...v,ids,n:ids.length,share:included.length ? ids.length/included.length*100 : null};
      }),
    };
  });
}
