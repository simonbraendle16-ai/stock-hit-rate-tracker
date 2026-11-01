import { describe,it,expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { researchTimeModel } from './research-time';
import { validateFibInput,type FibObservation } from './fibonacci';
import { ResearchTime } from '../components/research-time';
import { categoricalStats } from './fibonacci-categorical-stats';
const row=(i:number,extra:Partial<FibObservation>={}):FibObservation=>({...validateFibInput({stockId:1,wave:'4',degree:'Minor',timeframe:'1d',observedOn:'2026-10-22',status:'abgeschlossen',percent:null,anchorStart:null,anchorEnd:null,extreme:null,note:'Synthetic',evidence:{provenance:'Synthetic QA'}}),id:`77000000-0000-4000-8000-${String(i).padStart(12,'0')}`,version:1,ticker:'S7-QA',name:'Synthetic',market:'aktien',...extra});
const exact={kind:'exact' as const,value:6,unit:'hour' as const,timeBasis:'calendar' as const,measurementConvention:'first_entry_to_pivot' as const,zone:[50,61.8] as [number,number],originalText:null};
const render=(groups:ReturnType<typeof researchTimeModel>,perspective:'panorama'|'studio'|'structure'='panorama',state:'ready'|'error'|'pending'|'loading'='ready')=>renderToStaticMarkup(createElement(ResearchTime,{groups,perspective,state}));
describe('S7 time and duration presentation',()=>{
  it('never substitutes observedOn, an end date, or prose for historical start',()=>{
    const g=researchTimeModel([row(1),row(2,{periodTo:'2008-12-31'}),row(3,{evidence:{periodLabel:'2008'}})])[0];
    expect(g.chronology.n).toBe(0);expect(g.chronology.missing).toHaveLength(3);expect(render([g])).not.toContain('2026');
  });
  it('keeps year/month/day and approximate reports distinct without expanding dates',()=>{
    const rows=['year','month','day'].map((precision,i)=>row(i,{evidence:{historicalTime:{start:{precision:precision as 'year'|'month'|'day',date:['2008','2008-03','2008-03-01'][i]},end:null}}}));
    rows.push(row(4,{evidence:{historicalTime:{start:{precision:'year',date:'2008',approximate:true},end:null}}}));
    const g=researchTimeModel(rows)[0];expect(g.chronology.n).toBe(4);expect(g.chronology.distribution).toHaveLength(4);expect(g.chronology.distribution.every(d=>d.n===1&&d.share===25)).toBe(true);
    expect(render([g])).toContain('ungefähr');expect(render([g])).not.toContain('2008-01-01');
  });
  it('reuses exact comparisons, calendar normalization and class definitions without midpoint estimates',()=>{
    const a=row(1,{evidence:{targetZoneReversal:exact}}),b=row(2,{evidence:{targetZoneReversal:{...exact,value:0.5,unit:'day'}}});
    const g=researchTimeModel([a,b])[0];expect(g.exact.reversal.groups[0]).toMatchObject({n:2,average:9,median:9,unit:'hour'});
    expect(g.durations).toEqual(categoricalStats([a,b]).durations);expect(render([g])).toContain('Median 9');
  });
  it('excludes approximate, ranges, bounds, missing, running and unclear from exact means',()=>{
    const rows=[row(1,{evidence:{targetZoneReversal:exact}}),row(2,{evidence:{targetZoneReversal:{...exact,kind:'approximate'}}}),row(3),row(4,{status:'laufend',evidence:{targetZoneReversal:exact}}),row(5,{evidence:{measurementConfidence:'unklar',targetZoneReversal:exact}})];
    const {value,...base}=exact;
    rows.push(row(6,{evidence:{targetZoneReversal:{...base,kind:'range',lower:4,upper:12,lowerInclusive:true,upperInclusive:false}}}),row(7,{evidence:{targetZoneReversal:{...base,kind:'upper_bound',upper:12,upperInclusive:true}}}),row(8,{evidence:{targetZoneReversal:{...base,kind:'unknown'}}}));
    const g=researchTimeModel(rows)[0];expect(g.exact.reversal.groups[0].n).toBe(1);expect(g.exact.reversal.excluded).toHaveLength(7);expect(g.exact.reversal.denominator).toBe(8);
  });
  it('separates first visit, total visits, trading and legacy reversal classes',()=>{
    const rows=['first_visit','total_visits'].map((convention,i)=>row(i,{evidence:{durations:{residence:{bucket:'h4_12',timeBasis:'calendar',convention:convention as 'first_visit'|'total_visits',zone:[50,61.8]}}}}));
    rows.push(row(3,{evidence:{durations:{reversal:{bucket:'d1_3',timeBasis:'trading',convention:'reversal'}}}}));
    const g=researchTimeModel(rows)[0];expect(g.durations.groups).toHaveLength(3);expect(render([g])).toContain('Altangabe · Umkehrdauer');expect(g.exact.residence.groups).toHaveLength(0);
  });
  it('keeps variants, hierarchy, kind and measurement contexts separate',()=>{
    const rows=[row(1),row(2,{measurementKind:'expansion'}),row(3,{measurementBasis:'Other'}),row(4,{evidence:{parentId:row(1).id}}),row(5,{wave:'B',evidence:{waveVariant:'b_overshooting'}}),row(6,{wave:'B',evidence:{waveVariant:'b_undershooting'}})];
    expect(researchTimeModel(rows)).toHaveLength(6);
  });
  it('uses latest revisions and the complete population independently of perspective',()=>{
    const rows=Array.from({length:47},(_,i)=>row(i,{evidence:{targetZoneReversal:exact}}));
    rows.push({...rows[0],version:2,evidence:{}});
    const model=researchTimeModel(rows);expect(model[0].total).toBe(47);expect(model[0].exact.reversal.groups[0].n).toBe(46);
    for(const p of ['panorama','studio','structure'] as const){const html=render(model,p);expect(html).toContain('n=46');expect(html).not.toContain(rows[0].id);expect(html).not.toContain('Synthetic');}
  });
  it('suppresses stale time statistics for pending, loading, error and empty states',()=>{
    const model=researchTimeModel([row(1)]);for(const s of ['pending','loading','error'] as const)expect(render(model,'studio',s)).toBe('');expect(render([])).toBe('');
  });
});
