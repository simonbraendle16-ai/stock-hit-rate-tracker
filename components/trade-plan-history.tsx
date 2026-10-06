import type { TradeEventRow } from '@/lib/trade-events'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { payloadObject } from '@/lib/trade-history'
import type { tradeEventRevision } from '@/lib/db/schema'

const labels:Record<string,string>={entryPrice:'Einstieg',stopLoss:'Stop',takeProfit:'Kursziel',positionSize:'Menge',
  elliottInvalidation:'Invalidierung',elliottWaveCount:'Count',waveDegree:'Wellengrad',strategy:'Strategie',setupTags:'Setups',
  quoteCurrency:'Kurswährung',accountCurrency:'Kontowährung',quoteToAccountRate:'Plankurs Währungsumrechnung',feeEntry:'Einstiegsgebühr',feeExit:'Ausstiegsgebühr',
  planContext:'Planbedingungen',investedAmount:'Kapitaleinsatz',leverage:'Modellhebel',targets:'Zielstaffel',ruleReferences:'Bestätigte Regelversion',gaps:'Datenlücken',quantity:'Ausführungsmenge',price:'Ausführungskurs',fee:'Gebühr',at:'Ausgeführt am',notes:'Notizen',note:'Notiz',followedPlan:'Plan befolgt',reviewStatus:'Bewertungsstatus',lossAccepted:'Verlust akzeptiert',moodExitNote:'Gefühlsantwort',reviewDeferredUntil:'Zurückgestellt bis'}
function value(v:unknown,key:string):string {
  if(v==null) return 'Nicht dokumentiert'
  if(['at','reviewDeferredUntil'].includes(key)) return new Date(String(v)).toLocaleString('de-DE')
  if(typeof v==='boolean') return v?'Ja':'Nein'
  if(typeof v==='number') return v.toLocaleString('de-DE',{maximumFractionDigits:6})
  if(Array.isArray(v)){if(key==='targets') return v.length?v.map(t=>`${t.sharePct} % bei ${value(t.price,'price')}${t.note?` (${t.note})`:''}`).join('; '):'Ein Kursziel ohne Teilstaffel';
    if(key==='ruleReferences') return v.map(r=>`${r.name} · ${r.version??'Version offen'}: ${r.text}`).join('; ')||'Keine';
    return v.map(String).join('; ')||'Keine'}
  if(typeof v==='object') {const p=v as Record<string,unknown>;return [p.expectedMove,p.entryTrigger,p.stopManagement,p.targetManagement,p.riskConfirmed===true?'Risiko bestätigt':p.riskConfirmed===false?'Risikobestätigung offen':null].filter(Boolean).join(' · ')}
  return String(v)
}
function Snapshot({snapshot,quoteCurrency,accountCurrency}:{snapshot:Record<string,unknown>;quoteCurrency?:string|null;accountCurrency?:string|null}) {
  return <dl className="grid gap-2 text-sm">{Object.entries(labels).filter(([key])=>key in snapshot).map(([key,label])=>{
    const currency=['price','entryPrice','stopLoss','takeProfit','elliottInvalidation'].includes(key)?snapshot.quoteCurrency??quoteCurrency:
      ['fee','feeEntry','feeExit','investedAmount'].includes(key)?snapshot.accountCurrency??accountCurrency:null
    return <div key={key} className="grid gap-1 sm:grid-cols-[12rem_1fr]"><dt className="text-muted-foreground">{label}</dt><dd className="break-words">{value(snapshot[key],key)}{snapshot[key]!=null&&currency?` ${currency}`:''}</dd></div>
  })}</dl>
}
function sourceLabel(source:unknown) {
  const kind=source&&typeof source==='object'?(source as Record<string,unknown>).kind:source
  return kind==='user_statement'?'Nutzeraussage':kind==='assistant_interpretation'?'Assistenzdeutung':kind==='broker'?'Brokerbeleg':'Quelle nicht dokumentiert'
}
export function TradePlanHistory({events,revisions=[],quoteCurrency,accountCurrency}:{events:TradeEventRow[];revisions?:Array<typeof tradeEventRevision.$inferSelect>;quoteCurrency?:string|null;accountCurrency?:string|null}) {
  const rows=events.map(e=>({event:e,p:payloadObject(e.payload)})).filter(({p})=>p.planningSnapshot||p.before&&p.after)
  return <Card><CardHeader><CardTitle>Originalplan und Änderungen</CardTitle><CardDescription>Frühere Fassungen bleiben sichtbar. Fehlende historische Angaben werden nicht ergänzt.</CardDescription></CardHeader>
    <CardContent className="flex flex-col gap-3">{!rows.some(({p})=>p.planningSnapshot)&&<p className="text-sm text-muted-foreground">Kein vollständiger Originalplan bei der Eröffnung dokumentiert.</p>}
      {rows.map(({event:e,p})=><details key={e.id} className="rounded border border-border p-3"><summary className="cursor-pointer text-sm">{p.planningSnapshot?'Originalplan bei Eröffnung':e.note??'Änderung'} · {new Date(e.at).toLocaleString('de-DE')}</summary>
        <p className="my-2 text-xs text-muted-foreground">Erfasst am {new Date(e.createdAt).toLocaleString('de-DE')} · {sourceLabel(p.source)}{typeof p.reason==='string'?` · ${p.reason}`:''}</p>
        {p.planningSnapshot?<Snapshot snapshot={p.planningSnapshot as Record<string,unknown>}/>:<div className="grid gap-4 md:grid-cols-2"><div><p className="mb-2 font-medium">Vorher</p><Snapshot snapshot={p.before as Record<string,unknown>}/></div><div><p className="mb-2 font-medium">Nachher</p><Snapshot snapshot={p.after as Record<string,unknown>}/></div></div>}
      </details>)}
      {revisions.map(r=><details key={`revision-${r.id}`} className="rounded border border-border p-3">
        <summary className="cursor-pointer text-sm">Ausführungskorrektur · Ereignis {r.eventId} · Fassung {r.version}</summary>
        <p className="my-2 text-xs text-muted-foreground">Erfasst am {new Date(r.createdAt).toLocaleString('de-DE')} · {sourceLabel(r.source)} · {r.reason}</p>
        <div className="grid gap-4 md:grid-cols-2"><div><p className="mb-2 font-medium">Vorher{r.version===1?' · Originalausführung':''}</p><Snapshot snapshot={r.before as Record<string,unknown>} quoteCurrency={quoteCurrency} accountCurrency={accountCurrency}/></div>
          <div><p className="mb-2 font-medium">Nachher</p><Snapshot snapshot={r.after as Record<string,unknown>} quoteCurrency={quoteCurrency} accountCurrency={accountCurrency}/></div></div>
      </details>)}
    </CardContent></Card>
}
