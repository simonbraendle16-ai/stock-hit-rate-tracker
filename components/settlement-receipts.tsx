import type { TradeEventRow } from '@/lib/trade-events'
import { receiptFromPayload } from '@/lib/settlement-receipt'
import { SettlementReceiptForm } from './settlement-receipt-form'

export function SettlementReceipts({ events, currency }: { events: TradeEventRow[]; currency: string | null }) {
  const exits = events.filter(e => ['teilverkauf', 'geschlossen'].includes(e.type))
  if (!exits.length) return null
  return <section className="panel p-4">
    <h2 className="font-semibold">Tatsächliche Brokerabrechnung</h2>
    <p className="mt-2 text-sm text-muted-foreground">Automatische Belege und manuelle Ergänzungen werden je Ausstieg geprüft. Frühere Belegfassungen bleiben erhalten.</p>
    {exits.map(event => {
      const receipt = receiptFromPayload(event.payload)
      let version = 0
      try { version = Number(JSON.parse(event.payload ?? '{}').settlementVersion) || 0 } catch { /* Legacy event. */ }
      return <details key={event.id} className="mt-3 rounded border border-border p-3">
        <summary>Ausstieg {new Date(event.at).toLocaleString('de-DE')} · {receipt
          ? `${receipt.netAmount.toLocaleString('de-DE')} ${receipt.currency} netto · Belegversion ${version}` : 'Abrechnung offen'}</summary>
        {receipt ? <p className="mt-2 whitespace-pre-wrap text-sm">{receipt.source === 'avatrade_history' ? 'AvaTrade-Verlauf' : 'Manueller Brokerbeleg'}: {receipt.evidence}</p> : null}
        {currency ? <SettlementReceiptForm eventId={event.id} currency={currency} receipt={receipt} version={version} />
          : <p className="mt-2 text-sm">Zuerst die Depotwährung bestätigen.</p>}
      </details>
    })}
  </section>
}
