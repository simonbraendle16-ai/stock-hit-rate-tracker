'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { TradeRow } from '@/lib/trade-stats'
import { pendingReview } from '@/lib/trade-review-state'
import { updateTradeReview } from '@/app/actions/trade-history'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'

export function TradeReview({trade}:{trade:TradeRow}) {
  const router=useRouter(), [busy,setBusy]=useState(false),[followed,setFollowed]=useState<boolean|null>(trade.followedPlan)
  const [note,setNote]=useState(trade.moodExitNote??''),[accepted,setAccepted]=useState<boolean|null>(trade.reviewLossAccepted??null)
  const [until,setUntil]=useState(''),[reason,setReason]=useState('')
  if(trade.status!=='abgeschlossen') return null
  const pending=pendingReview(trade)
  const state=trade.reviewStatus==='skipped'?'Bewusst übersprungen':trade.reviewStatus==='deferred'&&!pending
    ?`Zurückgestellt bis ${new Date(trade.reviewDeferredUntil!).toLocaleString('de-DE')}`:pending?'Offen':trade.reviewStatus==null?(trade.followedPlan==null?'Nicht angefordert':'Historische Bewertung vorhanden'):'Erfasst'
  async function save(status:string) {
    setBusy(true)
    const body:Record<string,unknown>={status,source:{kind:'user_statement',confirmedByUser:true,capturedAt:new Date().toISOString()}}
    if(status==='completed') {body.followedPlan=followed;if(note.trim()) body.mood={note};if(accepted!==null) body.lossAccepted=accepted}
    if(status==='deferred') {if(!until){toast.error('Erinnerungszeitpunkt wählen.');setBusy(false);return} body.deferredUntil=new Date(until).toISOString()}
    if(status==='skipped') body.reason=reason
    try {await updateTradeReview(trade.id,trade.version,crypto.randomUUID(),body);toast.success('Bewertung gespeichert.');router.refresh()}
    catch(e){toast.error(e instanceof Error?e.message:'Speichern fehlgeschlagen.');router.refresh()}
    finally{setBusy(false)}
  }
  return <Card id="bewertung"><CardHeader><CardTitle>Deine Abschlussbewertung</CardTitle><CardDescription>{state}. Die Ausführung bleibt davon getrennt.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {!pending&&<Button variant="outline" disabled={busy} onClick={()=>save('pending')}>Bewertung öffnen</Button>}
      <div className="space-y-2"><Label>Plan befolgt?</Label><div className="flex gap-2">
        <Button type="button" variant={followed===true?'default':'outline'} onClick={()=>setFollowed(true)}>Ja</Button>
        <Button type="button" variant={followed===false?'default':'outline'} onClick={()=>setFollowed(false)}>Nein</Button></div></div>
      <div className="space-y-2"><Label htmlFor="review-mood">Wie ging es dir beim Ausstieg?</Label><Textarea id="review-mood" value={note} onChange={e=>setNote(e.target.value)} maxLength={2000}/></div>
      {trade.result==='verlust'&&<div className="space-y-2"><Label>Hast du den Verlust akzeptiert?</Label><div className="flex gap-2">
        <Button variant={accepted===true?'default':'outline'} onClick={()=>setAccepted(true)}>Ja</Button>
        <Button variant={accepted===false?'default':'outline'} onClick={()=>setAccepted(false)}>Noch nicht</Button></div></div>}
      <Button disabled={busy||followed===null} onClick={()=>save('completed')}>Bewertung speichern</Button>
      <div className="space-y-2"><Label htmlFor="review-until">Später erinnern</Label><Input id="review-until" type="datetime-local" value={until} onChange={e=>setUntil(e.target.value)}/><Button variant="outline" disabled={busy||!until} onClick={()=>save('deferred')}>Bis dahin zurückstellen</Button></div>
      <div className="space-y-2"><Label htmlFor="review-skip">Grund für bewusstes Überspringen</Label><Input id="review-skip" value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000}/><Button variant="outline" disabled={busy||!reason.trim()} onClick={()=>save('skipped')}>Bewertung überspringen</Button></div>
    </CardContent></Card>
}
