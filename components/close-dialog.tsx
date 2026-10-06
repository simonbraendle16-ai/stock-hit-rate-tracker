"use client"
import { useEffect, useState } from 'react'
import { closeTrade } from '@/app/actions/trades'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import type { TradeRow } from '@/lib/trade-stats'

export function CloseDialog({trade,open,onOpenChange,onDone,prefillExit=null,targetId=null}:{
  trade:TradeRow;open:boolean;onOpenChange:(v:boolean)=>void;onDone:()=>void;prefillExit?:number|null;targetId?:number|null
}) {
  const [exit,setExit]=useState(''),[fee,setFee]=useState(''),[at,setAt]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{if(open){setExit(prefillExit==null?'':String(prefillExit));setFee('');const d=new Date();setAt(new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16))}},[open,prefillExit])
  async function submit(){
    setBusy(true)
    try{
      await closeTrade(trade.id,{actualExitPrice:Number(exit),feeExit:fee===''?undefined:Number(fee),targetId,at:new Date(at).toISOString()})
      toast.success('Ausführung gespeichert. Deine Bewertung bleibt als Aufgabe offen.');onOpenChange(false);onDone()
    }catch(e){toast.error(e instanceof Error?e.message:'Speichern fehlgeschlagen.');onDone()}finally{setBusy(false)}
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader>
    <DialogTitle>{trade.ticker} abschließen</DialogTitle><DialogDescription>Erfasse den tatsächlichen Ausstieg. An die persönliche Bewertung erinnert dich die App und die nächste Sitzung.</DialogDescription>
    </DialogHeader><div className="space-y-4">
      <div className="space-y-2"><Label htmlFor="close-price">Tatsächlicher Ausstiegskurs ({trade.quoteCurrency??'Kurswährung offen'})</Label><Input id="close-price" type="number" min="0" step="any" value={exit} onChange={e=>setExit(e.target.value)}/>
        {prefillExit!==null&&<p className="text-xs text-muted-foreground">Der Zielkurs ist vorbelegt. Bestätige oder ersetze ihn durch den tatsächlichen Ausführungskurs.</p>}</div>
      <div className="space-y-2"><Label htmlFor="close-at">Ausgeführt am</Label><Input id="close-at" type="datetime-local" value={at} onChange={e=>setAt(e.target.value)}/></div>
      {trade.tradedWithMoney&&<div className="space-y-2"><Label htmlFor="close-fee">Ausstiegsgebühr ({trade.accountCurrency??'Kontowährung offen'})</Label><Input id="close-fee" type="number" min="0" step="any" value={fee} onChange={e=>setFee(e.target.value)} placeholder={String(trade.feeExit??0)}/></div>}
    </div><DialogFooter><Button disabled={busy||!(Number(exit)>0)||!at} onClick={submit}>{busy?'Wird gespeichert…':'Ausführung speichern'}</Button></DialogFooter></DialogContent></Dialog>
}
