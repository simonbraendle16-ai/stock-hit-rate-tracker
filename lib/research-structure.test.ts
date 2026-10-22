import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {type FibObservation,validateFibInput} from './fibonacci';
import {categoricalStats} from './fibonacci-categorical-stats';
import {structureModel} from './research-structure';
import {ResearchStructure} from '../components/research-structure';
import {readResearchQuery} from './fibonacci-query-values';
import {researchResult} from './fibonacci-research';
const row=(id:number,extra:Partial<FibObservation>={}):FibObservation=>({
  ...validateFibInput({stockId:1,wave:'4',degree:'Minor',timeframe:'1d',observedOn:'2026-01-01',status:'abgeschlossen',percent:null,evidence:{provenance:'Synthetic QA',reversalLocation:'at_level',reversalZone:[61.8,61.8],structureCode:'abc',structureConfidence:'bestaetigt',subdivision:'three_part',subdivisionConfidence:'bestaetigt'}}),
  id:`76000000-0000-4000-8000-${String(id).padStart(12,'0')}`,version:1,ticker:'QA',name:'Synthetic',market:'aktien',...extra,
});
const render=(rows:FibObservation[],state:'ready'|'loading'|'pending'|'error'='ready')=>renderToStaticMarkup(createElement(ResearchStructure,{groups:structureModel(rows),state}));
describe('S6 structure comparison',()=>{
  it('separates kind, degree, timeframe, direction and explicit wave variants',()=>{
    const a=row(1),rows=[a,row(2,{measurementKind:'expansion'}),row(3,{degree:'Primär'}),row(4,{timeframe:'1w'}),row(5,{evidence:{...a.evidence,waveDirection:'long'}}),row(6,{wave:'B',evidence:{...a.evidence,waveVariant:'b_overshooting'}}),row(7,{wave:'B',evidence:{...a.evidence,waveVariant:'b_undershooting'}})];
    const groups=structureModel(rows);expect(groups).toHaveLength(5);
    const main=groups.find(g=>g.kind==='retracement' && g.degree==='Minor' && g.timeframe==='1d' && g.direction==='unbekannt')!;
    expect(main.waves).toHaveLength(3);expect(main.total).toBe(3);expect(main.waves.map(w=>w.variant)).toContain('B überschießend');
  });
  it('keeps main waves, subwaves and different measurement references separate',()=>{
    const a=row(1),child=row(2,{evidence:{...a.evidence,parentId:a.id}}),other=row(3,{measurementBasis:'Welle 1'});
    const groups=structureModel([a,child,other]);expect(groups).toHaveLength(3);
    expect(groups.find(g=>g.hierarchy==='Unterwellen')?.total).toBe(1);
    expect(groups.find(g=>g.basis==='Welle 1')?.waves[0].n).toBe(1);
  });
  it('reuses existing end-zone denominators and keeps point/range and real zero distinct',()=>{
    const a=row(1),b=row(2,{evidence:{...a.evidence,reversalLocation:'between_levels',reversalZone:[61.8,88.7]}});
    const rows=[a,b,row(3,{wave:'B'}),row(4,{status:'laufend'}),row(5,{evidence:{provenance:'Missing'}})];
    const g=structureModel(rows)[0],w=g.waves.find(w=>w.wave==='4')!,existing=categoricalStats(rows.filter(r=>r.wave==='4'));
    expect(w.n).toBe(2);expect(w.total).toBe(4);expect(w.excluded).toEqual(existing.reversals.excluded);expect(w.levels).toEqual(existing.reversals.groups[0].distribution);
    expect(g.zones).toEqual([[61.8,61.8],[61.8,88.7]]);expect(w.levels.map(l=>l.share)).toEqual([50,50]);expect(render(rows)).toContain('0/1 · 0 %');
  });
  it('keeps missing basis distinct from 0% and hides case identifiers',()=>{
    const html=render([row(1),row(2,{wave:'B',evidence:{provenance:'Missing'}})]);
    expect(html).toContain('—');expect(html).toContain('Keine verwendbare Grundlage');expect(html).not.toContain('NaN');expect(html).not.toContain('76000000');
  });
  it('separates pattern confidence and counts confirmed subdivision without numeric measurement',()=>{
    const a=row(1),b=row(2,{evidence:{...a.evidence,measurementConfidence:'unklar',structureConfidence:'vermutet',subdivision:'five_part'}});
    const w=structureModel([a,b])[0].waves[0];
    expect(w.patterns.find(p=>p.confidence==='bestaetigt')?.n).toBe(1);expect(w.patterns.find(p=>p.confidence==='vermutet')?.n).toBe(0);
    expect(w.subdivisions.reduce((n,s)=>n+s.n,0)).toBe(2);expect(w.n).toBe(1);
  });
  it('uses latest revisions and the full selected population before pagination',()=>{
    const rows=Array.from({length:45},(_,i)=>row(i+1));
    const a=researchResult(rows,[],readResearchQuery(new URLSearchParams('limit=20'))),b=researchResult(rows,[],readResearchQuery(new URLSearchParams('limit=20&offset=20')));
    expect(a.items).toHaveLength(20);expect(structureModel(a.selected)).toEqual(structureModel(b.selected));
    expect(structureModel([...rows,{...rows[0],version:2,status:'ungueltig'}])[0].waves[0].n).toBe(44);
  });
  it.each(['loading','pending','error'] as const)('suppresses stale matrices and distributions in %s',state=>{
    const html=render([row(1)],state);expect(html).not.toContain('<table');expect(html).not.toContain('<figure');expect(html).not.toContain('data-research-structure');
  });
  it('handles empty selection and groups with only excluded cases',()=>{
    expect(render([])).toContain('Keine passenden Beobachtungen');const html=render([row(1,{status:'laufend'}),row(2,{status:'ungueltig'})]);
    expect(html).toContain('Keine verwendbaren Umkehrlevel');expect(html).toContain('Status laufend');expect(html).not.toContain('NaN');
  });
});
