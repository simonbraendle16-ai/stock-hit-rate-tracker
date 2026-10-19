import {it, expect} from "vitest";
import {WAVE_VARIANTS, waveChoice} from "./fibonacci-wave-variants";
import {validateFibInput, validateEvidence, type FibObservation} from "./fibonacci";
import {readResearchQuery} from "./fibonacci-query-values";
import {interpretFibSearch} from "./fibonacci-search";
import {researchResult, researchCsv} from "./fibonacci-research";
import {readResearchLocation, writeResearchLocation, defaultResearchView} from "./fibonacci-location";
const input = {stockId:1,wave:"B",degree:"Minor",timeframe:"1d",status:"abgeschlossen",observedOn:"2026-10-19",percent:null,evidence:{provenance:"Synthetic wave variant QA"}};
const row = (id:string, wave="B", code:unknown=null, extra:Record<string,unknown>={}) => ({id,version:1,ticker:"TEST",name:"Synthetic",market:"aktien",...validateFibInput({...input,wave,evidence:{...input.evidence,waveVariant:code,...extra}})}) as FibObservation;
it.each(WAVE_VARIANTS)("preserves explicit $label with its base wave",v=>{
  expect(waveChoice(v.code)).toEqual({wave:v.wave,waveVariant:v.code});
  expect(validateFibInput({...input,wave:v.wave,evidence:{...input.evidence,waveVariant:v.code}}).evidence?.waveVariant).toBe(v.code);
});
it("rejects unknown and incompatible variants; allows explicit clearing",()=>{
  expect(()=>validateEvidence({...input.evidence,waveVariant:"invented"})).toThrow();
  expect(()=>row("bad","C","b_overshooting")).toThrow(/Grundwelle/);
  expect(waveChoice("B")).toEqual({wave:"B",waveVariant:null});
  expect(row("clear").evidence?.waveVariant).toBeNull();
});
it.each([
  ["überschießende Welle B","b_overshooting","B"],
  ["Welle B überschießend","b_overshooting","B"],
  ["unterschießende Welle B","b_undershooting","B"],
  ["B unterschiessend","b_undershooting","B"],
  ["Welle C truncated","c_truncated","C"],
])("interprets %s without guessing scope",(text,code,wave)=>{
  const pending=interpretFibSearch(text,[]);
  expect(pending.filters).toMatchObject({wave,waveVariant:code});
  expect(pending.unknown).toEqual([]); expect(pending.ready).toBe(false);
  expect(interpretFibSearch(text,[],{}, {waveLabelScope:"self"}).ready).toBe(true);
});
it("rejects filter and search conflicts",()=>{
  expect(()=>readResearchQuery(new URLSearchParams("wave=C&waveVariant=b_overshooting"))).toThrow();
  expect(()=>readResearchQuery(new URLSearchParams("waveVariant=invalid"))).toThrow();
  expect(interpretFibSearch("C truncated",[],{waveVariant:"b_overshooting"},{waveLabelScope:"self"}).ready).toBe(false);
});
it("uses the same variant population for rows, stats and full CSV before pagination",()=>{
  const rows=[row("over","B","b_overshooting"),row("under","B","b_undershooting"),row("unknown"),row("truncated","C","c_truncated")];
  const all=researchResult(rows,[],readResearchQuery(new URLSearchParams("wave=B&waveLabelScope=self&limit=1")));
  expect(all.total).toBe(3); expect(all.items).toHaveLength(1);
  expect(all.stats!.categorical.waveVariants[0]).toMatchObject({wave:"B",n:2,denominator:3,excluded:[{id:"unknown"}],distribution:[{n:1,share:50},{n:1,share:50}]});
  const subset=researchResult(rows,[],readResearchQuery(new URLSearchParams("wave=B&waveVariant=b_overshooting&waveLabelScope=self")));
  expect(subset.items.map(r=>r.id)).toEqual(["over"]);
  expect(researchCsv(subset)).toContain("b_overshooting"); expect(researchCsv(subset)).not.toContain("b_undershooting");
  const unknown=researchResult([row("unknown")],[],readResearchQuery(new URLSearchParams()));
  expect(unknown.stats!.categorical.waveVariants[0]).toMatchObject({n:0,distribution:[{share:null},{share:null}]});
});
it("selects descendants from variant parents and keeps unrelated B branches excluded",()=>{
  const parent="71000000-0000-4000-8000-000000000001", other="71000000-0000-4000-8000-000000000002";
  const rows=[row(parent,"B","b_overshooting"),row(other,"B","b_undershooting"),row("child","A",null,{parentId:parent}),row("other-child","A",null,{parentId:other})];
  const result=researchResult(rows,[],readResearchQuery(new URLSearchParams("wave=B&waveVariant=b_overshooting&waveLabelScope=descendants")));
  expect(result.selected.map(r=>r.id).sort()).toEqual([parent,"child"].sort());
});
it("restores the variant from shared URL state",()=>{
  const view=defaultResearchView();view.request.filters={wave:"C",waveVariant:"c_truncated",waveLabelScope:"self"};
  expect(readResearchLocation(writeResearchLocation(new URLSearchParams(),view)).request.filters).toMatchObject(view.request.filters);
});
