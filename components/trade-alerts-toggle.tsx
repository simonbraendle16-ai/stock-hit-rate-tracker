'use client'

// Etappe 14: der Wecker-Schalter am einzelnen Trade.
//
// Bis Etappe 13 stand diese Entscheidung als Häkchen im Aktivieren-Dialog — also
// im denkbar schlechtesten Moment: Man trifft sie, während man an den Einstieg
// denkt, und ein einmaliges Übersehen kostet das Signal für die ganze Laufzeit.
// Hier steht sie dort, wo der Trade lebt, und ist jederzeit umkehrbar.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { BellOff, BellRing } from 'lucide-react'
import { setTradeAlertsEnabled } from '@/app/actions/alerts'
import { cn } from '@/lib/utils'

export function TradeAlertsToggle({
  tradeId,
  enabled,
  status,
}: {
  tradeId: number
  enabled: boolean
  status: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  // Bei abgeschlossenen und abgebrochenen Trades gibt es nichts mehr zu wecken —
  // ein Schalter dort wäre eine Frage ohne Folge.
  if (status !== 'geplant' && status !== 'aktiv') return null

  const toggle = async () => {
    setBusy(true)
    try {
      const { created, removed } = await setTradeAlertsEnabled(tradeId, !enabled)
      if (!enabled) {
        toast.success(
          created > 0
            ? `Wecker an — ${created} Kursmarke${created === 1 ? '' : 'n'} gesetzt.`
            : 'Wecker an. Es gab nichts Neues zu setzen.',
        )
      } else {
        toast.success(
          removed > 0
            ? `Wecker aus — ${removed} offene Marke${removed === 1 ? '' : 'n'} entfernt.`
            : 'Wecker aus.',
        )
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={cn(
        'inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors disabled:opacity-50',
        enabled
          ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/20'
          : 'border-border text-muted-foreground hover:text-foreground',
      )}
      title={
        enabled
          ? 'Meldet sich, wenn eine Marke aus diesem Plan erreicht wird'
          : 'Für diesen Trade kommt keine Meldung'
      }
    >
      {enabled ? <BellRing className="size-3" /> : <BellOff className="size-3" />}
      {enabled ? 'Wecker an' : 'Wecker aus'}
    </button>
  )
}
