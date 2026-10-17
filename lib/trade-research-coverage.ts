import type { PlanContext } from './plan-context';
export type TradeResearchRow = {
  ticker?:string; result?:string|null; id:number; stockId:number|null; status:string; direction:string;
  wave:string|null; degree:string|null; notes:string|null;
  planContext:PlanContext|null; plannedCRV:number|null;
};
export function tradeResearchCoverage(rows:readonly TradeResearchRow[]) {
  const field=(definition:string,get:(r:TradeResearchRow)=>unknown)=>{
    const included:{id:number;value:unknown}[]=[],excluded:{id:number;reason:string}[]=[];
    for(const r of [...rows].sort((a,b)=>a.id-b.id)) {
      const raw=get(r);
      const value=typeof raw === 'string' ? raw.trim() : raw;
      if(value==null || value==='')excluded.push({id:r.id,reason:'Angabe fehlt; kein Ausschluss aus anderen Kennzahlen'});
      else included.push({id:r.id,value});
    }
    return {definition,n:included.length,denominator:rows.length,included,excluded};
  };
  return {
    total:rows.length,
    status:field('Alle eingetragenen Trades, getrennt nach tatsächlichem Status.',r=>r.status),
    wave:field('Gespeicherter Count als Nutzeraussage/Hypothese; kein abgeschlossener Wellenmesswert.',r=>r.wave?.trim() || r.planContext?.expectedMove),
    degree:field('Explizit gespeicherter Wellengrad; nicht aus Countnotation abgeleitet.',r=>r.degree),
    direction:field('Handelsrichtung; keine Übernahme als Wellenrichtung.',r=>r.direction),
    plan:field('Bestätigter Plankontext unabhängig von Ausführung oder Abrechnung.',r=>r.planContext && ([r.planContext.expectedMove,r.planContext.entryTrigger,r.planContext.stopManagement,r.planContext.targetManagement].some(value=>typeof value === 'string' && value.trim().length>0) || r.planContext.riskConfirmed === true) ? r.planContext : null),
    notes:field('Vorhandene qualitative Angaben, unverändert mit Herkunft am Trade. Ziellevels sind keine beobachteten Umkehrlevels.',r=>r.notes),
    actualOutcome:field("Gespeicherter tatsächlicher qualitativer Abschluss (Gewinn/Verlust/Break-even), unabhängig von einer vollständigen Nettoabrechnung.",r=>r.status === "abgeschlossen" ? r.result : null),
    currentCRV:field('Aktuell gespeichertes geplantes CRV; kein ursprünglicher Eröffnungsplan, kein realisiertes R.',r=>Number.isFinite(r.plannedCRV) && r.plannedCRV!>0?r.plannedCRV:null),
  };
}


/** Recomputed from owned stored trades on every read; no opt-in or copy table. */
export function summarizeTradeResearch(rows: readonly TradeResearchRow[]) {
  const coverage = tradeResearchCoverage(rows);
  const distribution = (metric: typeof coverage.status) => {
    const groups = new Map<string, number[]>();
    for (const row of metric.included) {
      const value = String(row.value);
      groups.set(value, [...(groups.get(value) ?? []), row.id]);
    }
    return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([value, ids]) => ({ value, n: ids.length, ids }));
  };
  const outcomes = coverage.actualOutcome.included.filter(r => ['gewinn', 'verlust', 'breakeven'].includes(String(r.value)));
  const wins = outcomes.filter(r => r.value === 'gewinn').length;
  const crvs = coverage.currentCRV.included;
  return {
    total: rows.length,
    status: distribution(coverage.status),
    direction: distribution(coverage.direction),
    degree: distribution(coverage.degree),
    actualOutcome: {
      definition: 'Qualitative Trefferquote = gespeicherte Gewinne / abgeschlossene Trades mit bekanntem Gewinn, Verlust oder Break-even. Break-even zählt im Nenner. Keine Netto-Trefferquote.',
      n: outcomes.length,
      denominator: rows.filter(r => r.status === 'abgeschlossen').length,
      wins,
      losses: outcomes.filter(r => r.value === 'verlust').length,
      breakeven: outcomes.filter(r => r.value === 'breakeven').length,
      winRate: outcomes.length ? wins / outcomes.length : null,
      ids: outcomes.map(r => r.id),
    },
    currentCRV: {
      definition: 'Arithmetisches Mittel aller aktuell gespeicherten positiven Plan-CRV; unabhängig von Status oder Abrechnung. Kein realisiertes R.',
      n: crvs.length,
      denominator: rows.length,
      average: crvs.length ? crvs.reduce((sum, r) => sum + Number(r.value), 0) / crvs.length : null,
      ids: crvs.map(r => r.id),
    },
  };
}
