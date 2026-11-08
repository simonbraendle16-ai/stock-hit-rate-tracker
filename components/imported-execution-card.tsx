import Link from 'next/link'
import { importedExecution } from '@/lib/execution-import'
import type { TradeRow } from '@/lib/trade-stats'
import { formatMoney } from '@/lib/format'

export function ImportedExecutionCard({t}:{t:TradeRow}) {
  const e=importedExecution(t)
  if (!e) return null
  const date=(s:string)=>new Date(s).toLocaleString('de-DE')
  return <section className="panel sheen flex h-full flex-col gap-3 p-4">
    <div className="flex items-start justify-between gap-3">
      <div><Link href={`/trades/${t.id}`} className="font-heading text-base font-bold hover:text-primary">{t.ticker}</Link>
        <p className="text-xs text-muted-foreground">{t.direction === 'long'?'Long':'Short'} · {e.volumeLots} Lots · Match-Trader</p></div>
      <span className="text-xs">{e.closeTime?'Abgeschlossen':'Offen'}</span>
    </div>
    <dl className="grid grid-cols-2 gap-2 text-sm">
      <div><dt className="text-muted-foreground">Einstieg</dt><dd>{e.openPrice} · {date(e.openTime)}</dd></div>
      <div><dt className="text-muted-foreground">Ausstieg</dt><dd>{e.closeTime?`${e.closePrice} · ${date(e.closeTime)}`:'Noch offen'}</dd></div>
      {e.closeTime && <><div><dt className="text-muted-foreground">Brutto</dt><dd>{formatMoney(e.gross!,e.currency)}</dd></div>
        <div><dt className="text-muted-foreground">Netto inkl. Kosten</dt><dd className={e.net!<0?'text-destructive':'text-positive'}>{formatMoney(e.net!,e.currency)}</dd></div>
        <div><dt className="text-muted-foreground">Provision</dt><dd>{formatMoney(e.commission,e.currency)}</dd></div>
        <div><dt className="text-muted-foreground">Swap</dt><dd>{formatMoney(e.swap,e.currency)}</dd></div></>}
    </dl>
    <p className="text-xs text-muted-foreground">Brokerbeleg · Ursprünglicher Plan und Anfangsrisiko nicht erfasst; R-Auswertung offen.</p>
  </section>
}
