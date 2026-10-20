import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { validateFibInput, fibStats, type FibObservation } from './fibonacci';
import { readResearchQuery } from './fibonacci-query-values';
import { researchResult } from './fibonacci-research';
import { panoramaModel } from './research-panorama';
import { ResearchPanorama, ResearchDistribution } from '../components/research-panorama';

const row = (n: number, extra: Partial<FibObservation> = {}): FibObservation => ({
  ...validateFibInput({stockId:1,wave:'4',degree:'Minor',timeframe:'1d',observedOn:'2026-01-01',status:'abgeschlossen',percent:null,anchorStart:null,anchorEnd:null,extreme:null,note:'Synthetic QA',evidence:{
    provenance:'Synthetic local QA',catalogueVersion:1,reversalLocation:'at_level',reversalZone:[61.8,61.8],structureCode:'abc',
    subdivision:'three_part',subdivisionConfidence:'bestaetigt',targetZone:[50,61.8],expectationTiming:'retrospective',
  }}),id:`74000000-0000-4000-8000-${String(n).padStart(12,'0')}`,version:1,ticker:'S4-QA',name:'Synthetic',market:'aktien',...extra,
});
const render = (groups: ReturnType<typeof panoramaModel>,state: 'ready'|'error'|'pending'|'loading'='ready') => renderToStaticMarkup(createElement(ResearchPanorama,{groups,state}));

describe('S4 full-selection panorama contract',()=>{
  it('uses the existing aggregate IDs and denominators before pagination for both measurement kinds',()=>{
    const rows=Array.from({length:47},(_,i)=>row(i+1));rows.push(row(48,{measurementKind:'expansion'}));
    const a=researchResult(rows,[],readResearchQuery(new URLSearchParams('limit=20')));
    const b=researchResult(rows,[],readResearchQuery(new URLSearchParams('limit=20&offset=20&order=oldest')));
    expect(a.items).toHaveLength(20);
    const groups=panoramaModel(a.selected);
    expect(groups).toEqual(panoramaModel(b.selected));
    expect(groups.map(g=>g.total)).toEqual([47,1]);
    for (const g of groups) expect(g.categorical).toEqual(fibStats(a.selected,g.kind).categorical);
    expect(groups[0].categorical.reversals.groups[0].n).toBe(47);
    expect(groups[0].categorical.reversals.groups[0].distribution[0].ids).toHaveLength(47);
    expect(panoramaModel(a.selected,'expansion')).toHaveLength(1);
  });
  it('keeps missing, running, uncertain and invalid cases outside each applicable denominator',()=>{
    const confirmed=row(1),running=row(2,{status:'laufend'}),invalid=row(3,{status:'ungueltig'}),missing=row(4,{evidence:{provenance:'Not measured'}});
    const uncertain=row(5,{evidence:{...confirmed.evidence,measurementConfidence:'unklar',subdivisionConfidence:'vermutet'}});
    const g=panoramaModel([confirmed,running,invalid,missing,uncertain],'retracement')[0];
    expect(g.total).toBe(5);expect(g.completed).toBe(3);
    expect(g.structures.n).toBe(1);expect(g.structures.excluded).toBe(4);
    expect(g.categorical.reversals.excluded).toHaveLength(4);
    const level=g.categorical.levels.find(l=>l.level===61.8)!;
    expect(level.n).toBe(1);expect(level.share).toBe(100);expect(level.excluded).toHaveLength(4);
    expect(g.categorical.subdivisions.reduce((n,s)=>n+s.n,0)).toBe(1);
    const html=render([g]);expect(html).not.toContain(confirmed.id);expect(html).not.toContain('Synthetic');
    expect(html).toContain('4 ohne verwendbare Strukturfamilie');
  });
  it('counts subdivision without exact percentages and keeps pattern confidence independent',()=>{
    const a=row(1,{percent:null}), b=row(2,{percent:null,evidence:{...row(1).evidence,subdivision:'five_part',structureConfidence:'vermutet'}});
    const g=panoramaModel([a,b],'retracement')[0];
    expect(g.categorical.subdivisions.reduce((n,s)=>n+s.n,0)).toBe(2);
    expect(g.categorical.subdivisions).toHaveLength(2);
    expect(g.categorical.subdivisions.map(s=>s.patternConfidence).sort()).toEqual(['unbekannt','vermutet']);
  });
  it('keeps ABC subtypes in one family, point levels and ranges in distinct bins',()=>{
    const a=row(1),b=row(2,{evidence:{...a.evidence,structureCode:'abc_zigzag',reversalLocation:'between_levels',reversalZone:[61.8,88.7]}});
    const g=panoramaModel([a,b],'retracement')[0];
    expect(g.structures.n).toBe(2);expect(g.structures.distribution.find(d=>d.label==='abc')?.n).toBe(2);
    expect(g.categorical.reversals.groups[0].distribution).toHaveLength(2);
    expect(render([g])).toContain('Punktlevel');expect(render([g])).toContain('Bereich');
  });
  it('never turns missing grounds into zero and distinguishes known zero from unknown',()=>{
    const a=row(1,{evidence:{provenance:'QA',missedLevels:[61.8]}});
    const level=panoramaModel([a],'retracement')[0].categorical.levels.find(l=>l.level===61.8)!;
    expect(level.n).toBe(1);expect(level.share).toBe(0);
    const zero=renderToStaticMarkup(createElement(ResearchDistribution,{label:'Known zero',n:1,rows:[{label:'Erreicht',n:0,share:0}]}));
    const unknown=renderToStaticMarkup(createElement(ResearchDistribution,{label:'Unknown',n:0,rows:[]}));
    expect(zero).toContain('0/1 · 0 %');expect(unknown).toContain('Anteil nicht berechenbar');expect(unknown).not.toContain('0 %');
  });
  it.each(['error','pending','loading'] as const)('hides all figures and IDs for %s instead of showing old valid results',state=>{
    const html=render(panoramaModel([row(1)]),state);
    expect(html).not.toContain('<figure');expect(html).not.toContain('data-research-panorama');expect(html).not.toContain(row(1).id);
    expect(html).toContain(state==='error'?'role="alert"':'role="status"');
  });
  it('shows an empty selection and useful partial results separately',()=>{
    expect(render(panoramaModel([]))).toContain('Keine passenden Beobachtungen');
    const html=render(panoramaModel([row(1,{evidence:{provenance:'QA',subdivision:'three_part',subdivisionConfidence:'bestaetigt'}})]));
    expect(html).toContain('Noch keine bestätigten Umkehrlevel');expect(html).toContain('Dreiteilig');expect(html).not.toContain('NaN');
  });
  it('deduplicates revisions using the existing full-population path',()=>{
    const a=row(1),newer={...a,version:2,evidence:{...a.evidence,subdivision:'five_part' as const}};
    const g=panoramaModel([a,newer],'retracement')[0];
    expect(g.total).toBe(1);expect(g.categorical.subdivisions[0].distribution.find(d=>d.code==='five_part')?.n).toBe(1);
  });
});
