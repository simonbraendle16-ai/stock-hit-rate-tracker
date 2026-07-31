'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ChoiceButton, Field, FormSection } from '@/components/form-frame'
import { addCashflow, deleteCashflow, type Cashflow } from '@/app/actions/cashflows'
import { formatMoney } from '@/lib/format'
import { ArrowDownToLine, ArrowUpFromLine, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { PaperBadge } from '@/components/paper-badge'
import { normalizePortfolioKind, type PortfolioRow } from '@/lib/portfolio-scope'

function isoDate(d: Date | string): string {
  return new Date(d).toISOString().slice(0, 10)
}

/**
 * Ein- und Auszahlungen. Ohne sie rechnet die Rendite gegen ein fixes
 * Startkapital und wird ab der ersten Nachzahlung falsch.
 *
 * Seit Etappe 12 gehört jede Zahlung zu genau EINEM Depot. Ohne diese Zuordnung
 * würde eine Einzahlung die Rendite aller Depots gleichzeitig verfälschen — und
 * ein Papier-Startkapital wäre plötzlich durch echtes Geld größer.
 */
export function CashflowList({
  items,
  currency = 'EUR',
  portfolios,
  activePortfolioId = null,
}: {
  items: Cashflow[]
  currency?: string
  portfolios: PortfolioRow[]
  activePortfolioId?: number | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<'einzahlung' | 'auszahlung'>('einzahlung')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(isoDate(new Date()))
  const [note, setNote] = useState('')
  const [portfolioId, setPortfolioId] = useState<number | null>(activePortfolioId)

  const waehlbar = portfolios.filter((p) => p.archivedAt == null)
  const depotName = new Map(portfolios.map((p) => [p.id, p.name]))
  const istDemoDepot = (id: number) =>
    normalizePortfolioKind(portfolios.find((p) => p.id === id)?.kind ?? '') === 'demo'

  const net = items.reduce(
    (acc, c) => acc + (c.kind === 'auszahlung' ? -c.amount : c.amount),
    0,
  )

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Ohne Depot wäre nicht bestimmt, welches Konto das Geld bekommt. Der Server
    // lehnt es ebenso ab — hier nur früher und mit dem Hinweis am Feld.
    if (portfolioId == null) {
      toast.error('Bitte das Depot wählen, zu dem diese Zahlung gehört.')
      return
    }
    setBusy(true)
    try {
      await addCashflow({
        amount: parseFloat(amount),
        kind,
        occurredAt: date,
        note,
        portfolioId,
      })
      setAmount('')
      setNote('')
      toast.success(kind === 'einzahlung' ? 'Einzahlung erfasst.' : 'Auszahlung erfasst.')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Konnte nicht gespeichert werden.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: number) => {
    setBusy(true)
    try {
      await deleteCashflow(id)
      toast.success('Eintrag gelöscht.')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSection
      icon={ArrowDownToLine}
      title="Ein- und Auszahlungen"
      hint="Geld, das du auf das Handelskonto einzahlst oder entnimmst. Eine Auszahlung ist kein
        Verlust und zählt nicht in den Drawdown — die Rendite misst danach gegen dein
        tatsächlich eingesetztes Kapital."
      right={
        items.length > 0 ? (
          <span className="note">Netto {formatMoney(net, currency)}</span>
        ) : undefined
      }
      delay="rise-in-3"
      className="sheen"
    >
      <form onSubmit={submit} className="space-y-3">
        {/* Das Depot zuerst — eine Zahlung ohne Konto ist keine Zahlung. */}
        <Field
          label="Depot *"
          as="div"
          hint={
            portfolioId != null && istDemoDepot(portfolioId)
              ? 'Übungsdepot: Diese Zahlung verändert nur das Papierkapital.'
              : 'Bestimmt, welches Konto das Geld erhält bzw. abgibt.'
          }
        >
          <select
            value={portfolioId ?? ''}
            onChange={(e) => setPortfolioId(e.target.value ? Number(e.target.value) : null)}
            className="input-ocean h-11 w-full rounded-lg px-2.5 font-mono text-sm"
            required
          >
            <option value="">— Depot wählen —</option>
            {waehlbar.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {normalizePortfolioKind(p.kind) === 'demo' ? ' (Papiergeld)' : ''}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          {(['einzahlung', 'auszahlung'] as const).map((k) => (
            <ChoiceButton
              key={k}
              active={kind === k}
              tone={k === 'einzahlung' ? 'positive' : 'warning'}
              icon={k === 'einzahlung' ? ArrowDownToLine : ArrowUpFromLine}
              onClick={() => setKind(k)}
              className="py-2 text-xs uppercase"
            >
              {k}
            </ChoiceButton>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Betrag">
            <Input
              type="number"
              step="any"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="z. B. 2000"
              className="input-ocean h-11 font-mono"
              required
            />
          </Field>
          <Field label="Datum">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input-ocean h-11 font-mono"
              required
            />
          </Field>
        </div>

        <Field label="Notiz (optional)">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z. B. Sparplan, Entnahme für Miete"
            className="input-ocean h-11 font-mono"
          />
        </Field>

        <Button
          type="submit"
          disabled={busy}
          className="btn-teal-glow h-10 font-mono text-xs font-bold tracking-wider"
        >
          {busy ? 'WIRD GESPEICHERT…' : 'ERFASSEN'}
        </Button>
      </form>

      {items.length > 0 && (
        <div className="divide-y divide-border border-t border-border pt-1">
          {items.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 py-2 font-mono text-xs">
              <span className="flex items-center gap-2">
                {c.kind === 'einzahlung' ? (
                  <ArrowDownToLine className="size-3.5 text-positive" />
                ) : (
                  <ArrowUpFromLine className="size-3.5 text-warning" />
                )}
                <span
                  className={cn(
                    'font-bold',
                    c.kind === 'einzahlung' ? 'text-positive' : 'text-warning',
                  )}
                >
                  {c.kind === 'auszahlung' ? '−' : '+'}
                  {formatMoney(c.amount, currency)}
                </span>
                <span className="text-muted-foreground">
                  {new Date(c.occurredAt).toLocaleDateString('de-DE')}
                </span>
                {/* Das Depot steht an jeder Zeile: Bei mehreren Depots ist eine
                    Zahlung ohne Konto nicht einzuordnen. */}
                <span className="text-muted-foreground/70">
                  · {depotName.get(c.portfolioId) ?? '—'}
                </span>
                {istDemoDepot(c.portfolioId) && <PaperBadge size="compact" />}
                {c.note && <span className="text-muted-foreground/70">· {c.note}</span>}
              </span>
              <button
                type="button"
                onClick={() => remove(c.id)}
                disabled={busy}
                className="text-muted-foreground transition-colors hover:text-destructive"
                aria-label="Eintrag löschen"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </FormSection>
  )
}
