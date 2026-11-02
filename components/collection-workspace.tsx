'use client'
import {useEffect,useRef,useState} from 'react'
import {collectionPage,collectionDetail} from '@/app/actions/collection'
import {getFibonacciData} from '@/app/actions/fibonacci'
import type {CollectionPage} from '@/lib/collection-types'
import type {FibObservation} from '@/lib/fibonacci'
import {CategoricalFibForm} from './fibonacci-categorical-form'
import {FibonacciObservationDetails} from './fibonacci-observation-list'
import dynamic from 'next/dynamic'
const FibonacciPanel=dynamic(()=>import('./fibonacci-panel').then(m=>m.FibonacciPanel),{loading:()=> <p>Auswertung wird geladen ?</p>})
import {Button} from './ui/button'
import {Input} from './ui/input'
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from './ui/dialog'
type Instrument={id:number;name:string;ticker:string;market:string}
export function CollectionWorkspace({initial,instruments}:{initial:CollectionPage;instruments:Instrument[]}){
 const [page,setPage]=useState(initial),[query,setQuery]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [form,setForm]=useState<{existing:FibObservation|null}|null>(null),[detail,setDetail]=useState<FibObservation|null>(null)
 const [advanced,setAdvanced]=useState<Awaited<ReturnType<typeof getFibonacciData>>|null>(null)
 const firstSearch=useRef(true)
 const sequence=useRef(0),state=useRef({query,offset:page.offset,form});state.current={query,offset:page.offset,form}
 async function reload(q=query,offset=page.offset){const n=++sequence.current;setBusy(true);try{const next=await collectionPage(q,offset);if(n===sequence.current){setPage(next);setError('')}}catch{if(n===sequence.current)setError('Bestand konnte nicht geladen werden. Eingaben bleiben erhalten.')}finally{if(n===sequence.current)setBusy(false)}}
 useEffect(()=>{if(firstSearch.current){firstSearch.current=false;return}const timer=setTimeout(()=>{if(query!==state.current.query)return;void reload(query,0)},350);return()=>clearTimeout(timer)},[query])
 useEffect(()=>{const channel=new BroadcastChannel('tracker-waves');const update=()=>{if(!state.current.form)void reload(state.current.query,state.current.offset)};channel.onmessage=update;window.addEventListener('focus',update);return()=>{channel.close();window.removeEventListener('focus',update)}},[])
 async function open(id:string,edit:boolean){setBusy(true);try{const row=await collectionDetail(id);if(edit)setForm({existing:row});else setDetail(row);setError('')}catch{setError('Welle konnte nicht geladen werden. Bitte erneut versuchen.')}finally{setBusy(false)}}
 async function saved(row:FibObservation,counts?:{total:number;retracements:number;expansions:number},createdAt?:Date){
  const channel=new BroadcastChannel('tracker-waves');channel.postMessage({changed:true});channel.close()
  if(query||page.offset!==0||!counts||!createdAt){await reload(query,0);return}
  const prior=page.items.find(item=>item.id===row.id)
  if(counts.total!==page.total+(prior?0:1)||(prior&&prior.observedOn!==row.observedOn)){await reload(query,0);return}
  setPage(current=>{
   const previous=current.items.find(item=>item.id===row.id)
   if(previous&&previous.version>row.version)return current
   const item={id:row.id,version:row.version,stockId:row.stockId,ticker:row.ticker,name:row.name,market:row.market,wave:row.wave,degree:row.degree,timeframe:row.timeframe,status:row.status,observedOn:row.observedOn,measurementKind:row.measurementKind,percent:row.percent,createdAt}
   const items=[...current.items.filter(old=>old.id!==row.id),item].sort((a,b)=>b.observedOn.localeCompare(a.observedOn)||new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()||b.id.localeCompare(a.id)).slice(0,50)
   return {...current,...counts,matched:counts.total,items}
  })
 }
 async function loadAdvanced(){setBusy(true);try{setAdvanced(await getFibonacciData());setError('')}catch{setError('Erweiterte Suche konnte nicht geladen werden.')}finally{setBusy(false)}}
 return <section className="flex flex-col gap-5" aria-label="Wellensammlung">
 <p aria-label="Gespeicherter Gesamtbestand"><strong>{page.total} Beobachtungen insgesamt</strong> · {page.retracements} Retracements · {page.expansions} Expansionen</p>
 <div className="flex flex-wrap gap-3"><Button onClick={()=>setForm({existing:null})}>Welle erfassen</Button><Button variant="outline" onClick={()=>void loadAdvanced()} disabled={busy}>Erweiterte Suche und Auswertung</Button><a href="/analysis#fibonacci" className="self-center text-primary underline">Wellenstatistik öffnen</a></div>
 <label className="flex flex-col gap-2">Wellen suchen<Input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Instrument, Welle oder Notiz"/></label>
 {error&&<p role="alert">{error}<Button variant="outline" onClick={()=>void reload()}>Erneut laden</Button></p>}
 <p aria-live="polite">{busy?'Wird geladen …':`${page.matched} Treffer im gesamten Bestand`}</p>
 <div className="grid gap-3">{page.items.map(row=><article key={row.id} className="rounded-lg border p-4 flex flex-wrap items-center justify-between gap-3"><div><strong>{row.ticker} · Welle {row.wave}</strong><p className="text-sm text-muted-foreground">{row.observedOn} · {row.degree} · {row.timeframe} · {row.measurementKind==='expansion'?'Expansion':'Retracement'} · {row.status}</p></div><div className="flex gap-2"><Button variant="outline" onClick={()=>void open(row.id,false)} disabled={busy}>Details</Button><Button variant="outline" onClick={()=>void open(row.id,true)} disabled={busy}>Bearbeiten</Button></div></article>)}</div>
 {!page.items.length&&!busy&&<p>Keine passenden Beobachtungen.</p>}
 <nav aria-label="Wellen-Seiten" className="flex items-center gap-3"><Button variant="outline" disabled={busy||page.offset===0} onClick={()=>void reload(query,Math.max(0,page.offset-50))}>Zurück</Button><span>{page.matched?`${page.offset+1}–${Math.min(page.offset+50,page.matched)}`:'0'} von {page.matched}</span><Button variant="outline" disabled={busy||page.offset+50>=page.matched} onClick={()=>void reload(query,page.offset+50)}>Weiter</Button></nav>
 {advanced&&<details open><summary>Erweiterte Suche und vollständige Auswertung</summary><FibonacciPanel {...advanced} workspace="collection"/></details>}
 <Dialog open={!!form} onOpenChange={v=>{if(!v)setForm(null)}}><DialogContent className="flex max-h-[90svh] flex-col overflow-hidden sm:max-w-2xl"><DialogHeader><DialogTitle>{form?.existing?'Welle bearbeiten':'Welle erfassen'}</DialogTitle><DialogDescription>Änderungen werden unmittelbar gespeichert und zurückgelesen.</DialogDescription></DialogHeader>{form&&<CategoricalFibForm key={form.existing?.id??'new'} instruments={instruments} existing={form.existing} defaults={{}} lazyChoices onSaved={(row,counts,createdAt)=>void saved(row,counts,createdAt)} close={()=>setForm(null)}/>}</DialogContent></Dialog>
 <Dialog open={!!detail} onOpenChange={v=>{if(!v)setDetail(null)}}><DialogContent className="max-h-[90svh] overflow-y-auto"><DialogHeader><DialogTitle>Gespeicherte Welle</DialogTitle><DialogDescription>{detail?.ticker} · {detail?.wave}</DialogDescription></DialogHeader>{detail&&<FibonacciObservationDetails row={detail} expanded/>}</DialogContent></Dialog>
 </section>
}
