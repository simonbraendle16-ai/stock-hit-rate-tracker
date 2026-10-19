import { describe, it, expect } from 'vitest';
import { validateFibInput, type FibObservation } from './fibonacci';
import { readResearchQuery } from './fibonacci-query-values';
import { researchResult, researchCsv } from './fibonacci-research';
import { defaultResearchView, readResearchLocation, writeResearchLocation } from './fibonacci-location';
import { residenceConflict } from './fibonacci-duration-compatibility';
const instruments = [{id:1,name:'Tesla QA',ticker:'TSLA-QA'},{id:2,name:'Tesla Other',ticker:'TES-QA'}];
const residence = {kind:'exact' as const,value:8,unit:'hour' as const,timeBasis:'calendar' as const,measurementConvention:'first_visit',zone:[50,61.8] as [number,number],touchAndGo:false,originalText:'Synthetic eight hours'};
const row = (n:number, extra:Partial<FibObservation>={}):FibObservation => ({...validateFibInput({stockId:1,wave:'4',degree:'Minor',timeframe:'1d',observedOn:'2026-01-01',status:'abgeschlossen',percent:null,anchorStart:null,anchorEnd:null,extreme:null,note:'Synthetic QA',evidence:{provenance:'Synthetic',catalogueVersion:1,waveDirection:'short',reversalLocation:'at_level',reversalZone:[61.8,61.8],historicalTime:{start:{date:'2021',precision:'year'},end:{date:'2021',precision:'year'}},targetZoneResidence:residence,durations:{residence:{bucket:'h4_12',timeBasis:'calendar',convention:'first_visit',zone:[50,61.8]}}}}),id:`67000000-0000-4000-8000-${String(n).padStart(12,'0')}`,version:1,ticker:'TSLA-QA',name:'Tesla QA',market:'aktien',...extra});
const parse=(q:string)=>readResearchQuery(new URLSearchParams(q));

describe('T6 one population across pages, export and URL',()=>{
  it('keeps full metric IDs and level groups independent of order and page',()=>{
    const rows=Array.from({length:47},(_,i)=>row(i+1));
    const first=researchResult(rows,instruments,parse('levelFrom=61.8&levelMeaning=end&limit=20'));
    const second=researchResult(rows,instruments,parse('levelFrom=61.8&levelMeaning=end&limit=20&offset=20&order=oldest'));
    expect(first.items).toHaveLength(20);expect(second.items).toHaveLength(20);
    expect(first.total).toBe(47);expect(first.stats).toEqual(second.stats);
    expect(first.levelSelection).toEqual(second.levelSelection);
    expect(first.stats!.coverage.residenceComparisons.groups[0].n).toBe(47);
    const csv=researchCsv(second);for(const r of rows)expect(csv).toContain(r.id);
    expect(csv.split('\r\n').length).toBeGreaterThanOrEqual(1);
    expect(second.nextOffset).toBe(40);
    expect(researchResult(rows,instruments,parse('offset=100')).items).toEqual([]);
  });
  it('blocks ambiguity, unknown tokens and conflicts without final statistics or CSV',()=>{
    for(const q of ['Tesla Welle 4 61,8','Banane','Welle 4 Welle 5']) {
      const result=researchResult([row(1)],instruments,parse('query='+encodeURIComponent(q)));
      expect(result.ready).toBe(false);expect(result.total).toBeNull();expect(result.stats).toBeNull();
      expect(result.items).toEqual([]);expect(()=>researchCsv(result)).toThrow();
    }
  });
  it('resolves query choices using owned instruments and retains the same normalized filters',()=>{
    const request=parse('query='+encodeURIComponent('Tesla Welle 4 2020–2025 61,8'));
    request.resolutions={'instrument:0':'1',waveLabelScope:'self',levelMeaning:'end'};
    const result=researchResult([row(1)],instruments,request);
    expect(result.ready).toBe(true);expect(result.total).toBe(1);
    expect(result.filters).toMatchObject({stockId:1,wave:'4',from:'2020',to:'2025',levelFrom:61.8,levelMeaning:'end',waveLabelScope:'self'});
    request.resolutions['instrument:0']='999';
    expect(researchResult([row(1)],instruments,request).ready).toBe(false);
  });
  it.each(['levelFrom=60&levelMeaning=end','levelFrom=61.8','levelTo=50&levelFrom=61.8&levelMeaning=end','levelFrom=&levelMeaning=end','order=other','stockId=1&stockId=2','offset=-1','limit=0','resolutions=[]','resolutions={"__proto__":"x"}','unexpected=1','from=2025&to=2020'])('rejects invalid query %s',q=>expect(()=>parse(q)).toThrow());
  it('roundtrips search choices, filters, order, page, tab, direct detail and foreign page parameters',()=>{
    const view=defaultResearchView();view.request=parse('wave=4&waveLabelScope=descendants&levelFrom=61.8&levelMeaning=end&offset=20&limit=20&order=oldest');
    view.request.query='Tesla Welle 4';view.request.resolutions={'instrument:0':'1',waveLabelScope:'descendants'};
    view.tab='data-groups';view.detail=row(1).id;
    const p=writeResearchLocation(new URLSearchParams('other=keep&fib.obsolete=1'),view);
    expect(p.get('other')).toBe('keep');expect(p.has('fib.obsolete')).toBe(false);
    expect(readResearchLocation(p)).toEqual(view);
    view.request.filters.measurementKind=undefined;
    expect(readResearchLocation(writeResearchLocation(p,view)).request.filters.measurementKind).toBeUndefined();
  });
  it('preserves incomplete manual level edits while blocking their result',()=>{
    const v=readResearchLocation(new URLSearchParams('fib.levelFrom=61.8'));
    expect(researchResult([row(1)],instruments,v.request).ready).toBe(false);
  });
  it.each(['fib.detail=foreign','fib.tab=unknown','fib.stockId=2','fib.unknown=yes','fib.detail=x&fib.detail=y'])('rejects invalid view on stock page: %s',q=>expect(()=>readResearchLocation(new URLSearchParams(q),1)).toThrow());
});

describe('T7 existing duration contracts together',()=>{
  it('retains legacy precision while separately reporting three types and compatible classes',()=>{
    const r=row(1);r.evidence!.durations={...r.evidence!.durations,wave:{bucket:'d3_7',timeBasis:'calendar',convention:'whole_wave'},reversal:{bucket:'h1_4',timeBasis:'calendar',convention:'reversal'}};
    const result=researchResult([r,row(2,{evidence:{provenance:'Synthetic'}})],instruments,parse(''));
    expect(result.stats!.categorical.durations.groups.map(g=>g.type).sort()).toEqual(['residence','reversal','wave']);
    expect(result.stats!.coverage.residenceComparisons.groups[0].average).toBe(8);
    expect(result.stats!.categorical.levels.find(g=>g.level===61.8)!.reached).toEqual([r.id]);
    expect(researchCsv(result)).toContain('Synthetic eight hours');
  });
  it('excludes contradictory historical duration pairs only from duration metrics and retains original fields',()=>{
    const r=row(1);r.evidence!.targetZoneResidence={...residence,value:24};
    expect(residenceConflict(r.evidence)).toBeTruthy();
    const result=researchResult([r],instruments,parse(''));
    expect(result.stats!.categorical.durations.groups).toEqual([]);
    expect(result.stats!.coverage.residenceComparisons.groups).toEqual([]);
    expect(result.stats!.coverage.residenceComparisons.excluded[0].reason).toContain('widersprechen');
    expect(result.levelSelection!.total).toBe(0); // no active level search
    expect(result.stats!.categorical.levels.find(g=>g.level===61.8)!.reached).toEqual([r.id]);
    expect(result.selected[0].evidence!.targetZoneResidence!.value).toBe(24);
  });
  it('does not assume identical contexts, approximate point values or a trading-day hour count',()=>{
    const r=row(1);
    for(const patch of [{kind:'approximate' as const,value:24},{timeBasis:'unknown' as const,value:24},{measurementConvention:'total_visits',value:24},{zone:[61.8,88.7] as [number,number],value:24}]) expect(residenceConflict({...r.evidence,targetZoneResidence:{...residence,...patch}})).toBeNull();
    expect(residenceConflict({durations:{residence:{bucket:'d1_3',timeBasis:'trading',convention:'first_visit',zone:residence.zone}},targetZoneResidence:{...residence,timeBasis:'trading',unit:'hour',value:100}})).toBeNull();
  });
  it('keeps upper bounds, estimates, unknown measurement conventions and running cases outside exact means',()=>{
    const rows=[row(1),row(2),row(3),row(4),row(5)];
    rows[1].evidence!.targetZoneResidence={...residence,kind:'upper_bound',value:undefined,upper:1,upperInclusive:false,unit:'day'};
    rows[2].evidence!.targetZoneResidence={...residence,kind:'approximate'};
    rows[3].evidence!.targetZoneResidence={...residence,measurementConvention:null};
    rows[4].status='laufend';
    const result=researchResult(rows,instruments,parse(''));
    expect(result.stats!.coverage.residenceComparisons.groups[0].included.map(r=>r.id)).toEqual([rows[0].id]);
    expect(result.stats!.coverage.residenceComparisons.excluded).toHaveLength(4);
    expect(result.total).toBe(5);
  });
});
