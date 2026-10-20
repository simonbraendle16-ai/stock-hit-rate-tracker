import {it,expect} from 'vitest';
import {validateFibInput,validateEvidence,fibStats,type FibObservation,type FibEvidence} from './fibonacci';
import {interpretFibSearch} from './fibonacci-search';
import {readResearchQuery} from './fibonacci-query-values';
import {researchResult,researchCsv} from './fibonacci-research';
import {defaultResearchView,writeResearchLocation,readResearchLocation} from './fibonacci-location';
const row=(n:number,e:Partial<FibEvidence>={},extra:Partial<FibObservation>={}):FibObservation=>({
  ...validateFibInput({stockId:1,wave:'A',degree:'Minor',timeframe:'1d',observedOn:'2026-10-20',status:'abgeschlossen',percent:61.8,evidence:{provenance:'Synthetic subdivision QA',...e}}),
  id:`72000000-0000-4000-8000-${String(n).padStart(12,'0')}`,version:1,name:'Synthetic',ticker:'TEST',market:'aktien',...extra,
});
const confirmed={subdivision:'three_part',subdivisionConfidence:'bestaetigt'} as const;
it('keeps subdivision, pattern and parent independent; never infers from price or pattern',()=>{
  expect(row(1,confirmed).evidence).toMatchObject(confirmed);
  expect(row(1,confirmed).evidence?.structureCode).toBeUndefined();
  const parent=row(2,{structureCode:'flat_expanded'});
  const child=row(3,{...confirmed,parentId:parent.id},{wave:'B'});
  expect(child.evidence?.structureCode).toBeUndefined();
  expect(parent.evidence?.subdivision).toBeUndefined();
  expect(row(4,{structureCode:'impulse'}).evidence?.subdivision).toBeUndefined();
  expect(validateEvidence({subdivision:null,subdivisionConfidence:null,provenance:'Synthetic explicit clearing'})).toMatchObject({subdivision:null,subdivisionConfidence:null});
});
it.each([{subdivision:'abc'}, {subdivision:3}, {subdivisionConfidence:true}, {subdivisionConfidence:'certain'}])('rejects invalid classifications %j',e=>{
  expect(()=>validateEvidence(e)).toThrow();
});
it.each([
  ['dreiteilige A','three_part'],['fünfteilige A','five_part'],['A fuenfteilig','five_part'],
  ['Unterteilung:three_part A','three_part'],['subdivision:five_part A','five_part'],
])('interprets %s with explicit scope resolution',(text,code)=>{
  const result=interpretFibSearch(text,[],{}, {waveLabelScope:'self'});
  expect(result.ready).toBe(true);expect(result.filters).toMatchObject({wave:'A',subdivision:code});
});
it('combines pattern and confidence; blocks conflicting subdivisions and unknown values',()=>{
  const r=interpretFibSearch('B Flat dreiteilig Unterteilungssicherheit:bestätigt',[],{}, {waveLabelScope:'self'});
  expect(r.ready).toBe(true);expect(r.filters).toMatchObject({wave:'B',structure:'family:abc_flat',subdivision:'three_part',subdivisionConfidence:'bestaetigt'});
  expect(interpretFibSearch('dreiteilig fünfteilige',[]).ready).toBe(false);
  expect(()=>readResearchQuery(new URLSearchParams('subdivision=invalid'))).toThrow();
  expect(()=>readResearchQuery(new URLSearchParams('subdivisionConfidence=invalid'))).toThrow();
});
it('uses confirmed cases once, preserves unknown and provisional cases, and separates measurement kinds',()=>{
  const rows=[row(1,confirmed),row(2,{subdivision:'five_part',subdivisionConfidence:'bestaetigt'}),row(3,{...confirmed,subdivisionConfidence:'vermutet'}),row(4),row(5,confirmed,{status:'laufend'}),row(6,confirmed,{measurementKind:'expansion'}),row(7,confirmed,{evidence:{...confirmed,measurementConfidence:'unklar'}})];
  const stats=fibStats([...rows,rows[0]]);
  const g=stats.categorical.subdivisions[0];
  expect(g).toMatchObject({n:3,denominator:6,distribution:[{n:2},{n:1}]});
  expect(g.excluded.map(r=>r.id)).toEqual([rows[2].id,rows[3].id,rows[4].id]);
  expect(g.uncertain).toHaveLength(2);expect(g.provisional).toHaveLength(1);
  expect(fibStats(rows,'expansion').categorical.subdivisions[0].n).toBe(1);
  expect(stats.n).toBe(4); // Unclear measurement excluded only from price metrics.
});
it('keeps filtered distributions, levels, CSV, pagination and URL on the same population',()=>{
  const rows=[row(1,confirmed),row(2,confirmed),row(3,{subdivision:'five_part',subdivisionConfidence:'bestaetigt'})];
  const request=readResearchQuery(new URLSearchParams('subdivision=three_part&subdivisionConfidence=bestaetigt&limit=1'));
  const r=researchResult(rows,[],request);
  expect(r.total).toBe(2);expect(r.items).toHaveLength(1);expect(r.stats!.n).toBe(2);expect(r.stats!.median).toBe(61.8);
  expect(r.stats!.categorical.subdivisions[0]).toMatchObject({n:2,denominator:2});
  expect(researchCsv(r)).toContain(rows[1].id);expect(researchCsv(r)).not.toContain(rows[2].id);
  const view=defaultResearchView();view.request.filters=request.filters;
  expect(readResearchLocation(writeResearchLocation(new URLSearchParams(),view)).request.filters).toMatchObject(request.filters);
  expect(researchResult([row(4)],[],readResearchQuery(new URLSearchParams('subdivision=unknown'))).total).toBe(1);
});
it('does not convert zones into exact measurements or parent patterns into own patterns',()=>{
  const rows=[row(1,{...confirmed,reversalZone:[50,61.8]},{percent:null}),row(2,{...confirmed,structureCode:'abc_flat'},{wave:'B'})];
  const r=researchResult(rows,[],readResearchQuery(new URLSearchParams('subdivision=three_part')));
  expect(r.stats!.n).toBe(1);expect(r.stats!.coverage.reversalZone.n).toBe(1);
  expect(r.stats!.categorical.subdivisions).toHaveLength(2);
});
