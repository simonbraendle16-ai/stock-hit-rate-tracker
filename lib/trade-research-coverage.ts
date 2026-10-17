import type { PlanContext } from './plan-context';
export type TradeResearchRow = {
  result?:string|null; id:number; stockId:number|null; status:string; direction:string;
  wave:string|null; degree:string|null; notes:string|null;
  planContext:PlanContext|null; plannedCRV:number|null;
};
export function tradeResearchCoverage(rows:readonly TradeResearchRow[]) {
  const field=(definition:string,get:(r:TradeResearchRow)=>unknown)=>{
    const included:{id:number;value:unknown}[]=[],excluded:{id:number;reason:string}[]=[];
    for(const r of [...rows].sort((a,b)=>a.id-b.id)) {
      const value=get(r);
      if(value==null || value==='')excluded.push({id:r.id,reason:'Angabe fehlt; kein Ausschluss aus anderen Kennzahlen'});
      else included.push({id:r.id,value});
    }
    return {definition,n:included.length,denominator:rows.length,included,excluded};
  };
  return {
    total:rows.length,
    status:field('Alle eingetragenen Trades, getrennt nach tatsächlichem Status.',r=>r.status),
    wave:field('Gespeicherter Count als Nutzeraussage/Hypothese; kein abgeschlossener Wellenmesswert.',r=>r.wave ?? r.planContext?.expectedMove),
    degree:field('Explizit gespeicherter Wellengrad; nicht aus Countnotation abgeleitet.',r=>r.degree),
    direction:field('Handelsrichtung; keine Übernahme als Wellenrichtung.',r=>r.direction),
    plan:field('Bestätigter Plankontext unabhängig von Ausführung oder Abrechnung.',r=>r.planContext),
    notes:field('Vorhandene qualitative Angaben, unverändert mit Herkunft am Trade. Ziellevels sind keine beobachteten Umkehrlevels.',r=>r.notes),
    actualOutcome:field("Gespeicherter tatsächlicher qualitativer Abschluss (Gewinn/Verlust/Break-even), unabhängig von einer vollständigen Nettoabrechnung.",r=>r.status === "abgeschlossen" ? r.result : null),
    currentCRV:field('Aktuell gespeichertes geplantes CRV; kein ursprünglicher Eröffnungsplan, kein realisiertes R.',r=>Number.isFinite(r.plannedCRV) && r.plannedCRV!>0?r.plannedCRV:null),
  };
}
