'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { TradeEventRow } from '@/lib/trade-events'
import { correctTradeExecution } from '@/app/actions/trade-history'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'

function localDate(at:Date) {const d=new Date(at);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,19)}
function CorrectionRow({event,tradeId,version}:{event:TradeEventRow;tradeId:number;version:number}) {
  const router=useRouter(),[price,setPrice]=useState(String(event.price??'')),[qty,setQty]=useState(String(event.quantity??'')),[fee,setFee]=useState(String(event.fee??''))
  const [at,setAt]=useState(localDate(event.at)),[reason,setReason]=useState(''),[busy,setBusy]=useState(false)
  async function save(){
    const patch:Record<string,unknown>={}
    if(price!==String(event.price??'')) patch.price=Number(price)
    if(qty!==String(event.quantity??'')) patch.quantity=Number(qty)
    if(fee!==String(event.fee??'')) patch.fee=Number(fee)
    if(at!==localDate(event.at)) patch.at=new Date(at).toISOString()
    if(!Object.keys(patch).length){toast.error('Keine Ausführungsangabe geändert.');return}
    setBusy(true)
    try {await correctTradeExecution(tradeId,event.id,version,crypto.randomUUID(),{patch,reason,source:{kind:'user_statement',confirmedByUser:true,capturedAt:new Date().toISOString()}});toast.success('Korrektur gespeichert; Original erhalten.');router.refresh()}
    catch(e){toast.error(e instanceof Error?e.message:'Speichern fehlgeschlagen.');router.refresh()}finally{setBusy(false)}
  }
  return <details className="rounded border border-border p-3"><summary className="cursor-pointer text-sm">{event.type==='eroeffnet'?'Eröffnung':event.type==='nachkauf'?'Nachkauf':event.type==='teilverkauf'?'Teilverkauf':'Abschluss'} · {new Date(event.at).toLocaleString('de-DE')}</summary>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <div><Label htmlFor={`correction-price-${event.id}`}>Ausführungskurs</Label><Input id={`correction-price-${event.id}`} type="number" step="any" min="0" value={price} onChange={e=>setPrice(e.target.value)}/></div>
      <div><Label htmlFor={`correction-qty-${event.id}`}>Menge (Stück / Basiseinheiten)</Label><Input id={`correction-qty-${event.id}`} type="number" step="any" min="0" value={qty} onChange={e=>setQty(e.target.value)}/></div>
      <div><Label htmlFor={`correction-fee-${event.id}`}>Gebühr in Kontowährung</Label><Input id={`correction-fee-${event.id}`} type="number" step="any" min="0" value={fee} onChange={e=>setFee(e.target.value)}/></div>
      <div><Label htmlFor={`correction-at-${event.id}`}>Ausgeführt am</Label><Input id={`correction-at-${event.id}`} type="datetime-local" step="1" value={at} onChange={e=>setAt(e.target.value)}/></div>
      <div className="sm:col-span-2"><Label htmlFor={`correction-reason-${event.id}`}>Korrekturgrund</Label><Input id={`correction-reason-${event.id}`} value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000}/></div>
      <Button disabled={busy||!reason.trim()} onClick={save}>Korrektur speichern</Button>
    </div></details>
}
export function ExecutionCorrection({tradeId,version,events}:{tradeId:number;version:number;events:TradeEventRow[]}) {
  const executions=events.filter(e=>['eroeffnet','nachkauf','teilverkauf','geschlossen'].includes(e.type))
  if(!executions.length) return null
  return <Card><CardHeader><CardTitle>Ausführung berichtigen</CardTitle><CardDescription>Originalangaben bleiben erhalten. Konflikte mit späteren Ausführungen oder Brokerbelegen werden vor dem Speichern geprüft.</CardDescription></CardHeader>
    <CardContent className="space-y-2">{executions.map(e=><CorrectionRow key={`${e.id}-${version}`} event={e} tradeId={tradeId} version={version}/>)}</CardContent></Card>
}
