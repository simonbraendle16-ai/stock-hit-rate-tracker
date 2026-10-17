import {it,expect} from 'vitest';
import {tradeResearchCoverage,type TradeResearchRow} from './trade-research-coverage';
it('keeps planned, active and closed trades with missing billing in qualitative metrics',()=>{
 const base={stockId:1,direction:'short',wave:null,degree:null,notes:null,planContext:null,plannedCRV:null};
 const rows=[{...base,id:1,status:'geplant',wave:'B',plannedCRV:5},{...base,id:2,status:'aktiv',notes:'Qualitative source'},{...base,id:3,status:'abgeschlossen',result:'verlust'}] as TradeResearchRow[];
 const c=tradeResearchCoverage(rows);
 expect(c.total).toBe(3);expect(c.actualOutcome.n).toBe(1);expect(c.wave.n).toBe(1);expect(c.notes.n).toBe(1);expect(c.currentCRV.included).toEqual([{id:1,value:5}]);expect(c.direction.n).toBe(3);expect(c.degree.excluded).toHaveLength(3);
 expect(tradeResearchCoverage([...rows,rows[0]].filter((r,i,a)=>a.findIndex(x=>x.id===r.id)===i))).toEqual(c);
});
