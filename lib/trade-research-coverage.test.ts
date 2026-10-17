import {it,expect} from 'vitest';
import {tradeResearchCoverage,summarizeTradeResearch,type TradeResearchRow} from './trade-research-coverage';
it('keeps planned, active and closed trades with missing billing in qualitative metrics',()=>{
 const base={stockId:1,direction:'short',wave:null,degree:null,notes:null,planContext:null,plannedCRV:null};
 const rows=[{...base,id:1,status:'geplant',wave:'B',plannedCRV:5},{...base,id:2,status:'aktiv',notes:'Qualitative source'},{...base,id:3,status:'abgeschlossen',result:'verlust'}] as TradeResearchRow[];
 const c=tradeResearchCoverage(rows);
 expect(c.total).toBe(3);expect(c.actualOutcome.n).toBe(1);expect(c.wave.n).toBe(1);expect(c.notes.n).toBe(1);expect(c.currentCRV.included).toEqual([{id:1,value:5}]);expect(c.direction.n).toBe(3);expect(c.degree.excluded).toHaveLength(3);
 expect(tradeResearchCoverage([...rows,rows[0]].filter((r,i,a)=>a.findIndex(x=>x.id===r.id)===i))).toEqual(c);
});

const base: TradeResearchRow = {id:1,stockId:null,status:'geplant',direction:'short',wave:null,degree:null,notes:null,planContext:null,plannedCRV:null};
it('automatically includes new drafts and updates every available metric without a wave link or settlement',()=>{
  const initial = summarizeTradeResearch([]);
  expect(initial.total).toBe(0); expect(initial.currentCRV.average).toBeNull(); expect(initial.actualOutcome.winRate).toBeNull();
  const rows = [{...base, wave:'C',plannedCRV:5}, {...base,id:2,status:'aktiv',notes:'Confirmed source'}];
  const next = summarizeTradeResearch(rows);
  expect(next.total).toBe(2); expect(next.currentCRV.average).toBe(5); expect(next.currentCRV.n).toBe(1);
  expect(next.actualOutcome.n).toBe(0); expect(next.direction).toEqual([{value:'short',n:2,ids:[1,2]}]);
  rows[0]={...rows[0],plannedCRV:7};
  expect(summarizeTradeResearch(rows).currentCRV.average).toBe(7);
  expect(summarizeTradeResearch(rows)).toEqual(summarizeTradeResearch(rows));
});
it('uses known actual outcomes, counts break-even in the qualitative denominator, and keeps missing money unknown',()=>{
 const rows=[{...base,status:'abgeschlossen',result:'gewinn'}, {...base,id:2,status:'abgeschlossen',result:'verlust'}, {...base,id:3,status:'abgeschlossen',result:'breakeven'}, {...base,id:4,status:'abgeschlossen'}, {...base,id:5,result:'gewinn'}];
 const summary=summarizeTradeResearch(rows);
 expect(summary.actualOutcome).toMatchObject({n:3,denominator:4,wins:1,losses:1,breakeven:1,winRate:1/3,ids:[1,2,3]});
 expect(summary.currentCRV.average).toBeNull();
 expect(summarizeTradeResearch([{...base,plannedCRV:0},{...base,id:2,plannedCRV:NaN}]).currentCRV.n).toBe(0);
});

it('does not count an empty stored plan object or blank text as confirmed plan information',()=>{
 const row={...base,notes:'  ',wave:'',planContext:{version:1 as const,expectedMove:'',entryTrigger:'',stopManagement:'',targetManagement:'',riskConfirmed:false}};
 const result=tradeResearchCoverage([row]);
 expect(result.plan.n).toBe(0);expect(result.notes.n).toBe(0);expect(result.wave.n).toBe(0);
 expect(tradeResearchCoverage([{...row,planContext:{...row.planContext,riskConfirmed:true}}]).plan.n).toBe(1);
 expect(tradeResearchCoverage([{...row,planContext:{...row.planContext,expectedMove:'C'}}]).wave.n).toBe(1);
});
