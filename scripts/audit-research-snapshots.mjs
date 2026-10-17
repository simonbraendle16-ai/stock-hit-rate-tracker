// Read-only audit of explicit user-owned snapshots. Never loads credentials or writes a database.
import {registerHooks} from 'node:module'
import {existsSync,readFileSync,writeFileSync} from 'node:fs'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {resolve,dirname} from 'node:path'
const root=fileURLToPath(new URL('..',import.meta.url))
registerHooks({resolve(specifier,context,next){
 if(specifier.startsWith('@/'))return {url:pathToFileURL(resolve(root,specifier.slice(2)+'.ts')).href,shortCircuit:true}
 if(specifier.startsWith('.') && context.parentURL?.endsWith('.ts')){
  const path=resolve(dirname(fileURLToPath(context.parentURL)),specifier+'.ts')
  if(existsSync(path))return {url:pathToFileURL(path).href,shortCircuit:true}
 }
 return next(specifier,context)
}})
const {fibStats}=await import('../lib/fibonacci.ts')
const {metricSamples,researchMetrics}=await import('../lib/research-metrics.ts')
const {tradeResearchCoverage}=await import('../lib/trade-research-coverage.ts')
const [wavesPath,tradesPath,manifestPath,outPath]=process.argv.slice(2)
const read=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''))
const waves=read(wavesPath).items,trades=read(tradesPath),manifest=read(manifestPath)
const reviewed=waves.map(r=>{
 const e=manifest.cases.find(e=>e.id===r.id)
 if(!e)throw Error('Unreviewed observation '+r.id)
 return {...r,...e.changes,evidence:e.evidence}
})
const samples=metricSamples(trades,new Map(trades.map(t=>[t.id,t.events ?? []])))
const tc=tradeResearchCoverage(trades.map(t=>({result:t.result,id:t.id,stockId:t.stockId,status:t.status,direction:t.direction,wave:t.elliottWaveCount,degree:t.waveDegree,notes:t.notes,planContext:t.planContext,plannedCRV:t.riskRewardRatio})))
const result={source:'Explizite frische API-Snapshots; Bestandszuordnung manuell geprüft. Projektion ist keine Produktionsübernahme.',
 waveProjection:{retracement:fibStats(reviewed,'retracement').coverage,expansion:fibStats(reviewed,'expansion').coverage},
 productionWaveCounts:{total:waves.length,retracement:fibStats(waves).n,expansion:fibStats(waves,'expansion').n},
 tradeSummary:Object.fromEntries(Object.entries(tc).map(([key,v])=>[key,typeof v==='number'?v:{definition:v.definition,n:v.n,denominator:v.denominator,included:v.included.map(r=>r.id),excluded:v.excluded}])),
 actualMetrics:researchMetrics(samples),
 trades:trades.map(t=>({id:t.id,ticker:t.ticker,status:t.status,version:t.version,qualitativeResult:t.result,hasCount:!!t.elliottWaveCount,hasDegree:!!t.waveDegree,hasPlanContext:!!t.planContext,hasNotes:!!t.notes,linkedObservations:waves.filter(w=>w.tradeId===t.id).map(w=>w.id),metrics:samples.find(s=>s.id===t.id) ?? null,exclusion:t.status==='abgeschlossen'?'Kennzahlweise fehlende Abrechnungs-/FX-/ursprüngliche Risikodaten, siehe null-Werte':'Kein Gesamtabschluss; qualitative Angaben bleiben berücksichtigt'}))}
writeFileSync(outPath,JSON.stringify(result,null,2)+'\n','utf8')
console.log(JSON.stringify({waves:waves.length,trades:trades.length,closed:samples.length,tradeSummary:Object.fromEntries(Object.entries(tc).map(([k,v])=>[k,typeof v==='number'?v:v.n])),actualMetrics:result.actualMetrics}))
