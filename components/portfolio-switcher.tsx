'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronDown, FlaskConical, Landmark, Layers } from 'lucide-react'
import { setActiveScope } from '@/app/actions/portfolios'
import {
  formatScope,
  normalizePortfolioKind,
  type PortfolioRow,
  type Scope,
} from '@/lib/portfolio-scope'
import { cn } from '@/lib/utils'

/**
 * Der Depot-Umschalter (Etappe 12) — die Antwort auf „welche Zahlen sehe ich hier
 * eigentlich".
 *
 * Er steht in der Kopfzeile und nicht auf der Auswertungsseite, weil er nicht nur
 * eine Ansicht filtert: Er bestimmt auch, wohin ein neuer Trade gebucht wird. Wer
 * beim Erfassen nicht sieht, in welchem Depot er sich befindet, macht genau den
 * Fehler wieder, der diese Etappe ausgelöst hat.
 *
 * Der Eintrag „Alle Echtgeld-Depots" fasst zusammen — und enthält NIE ein
 * Übungsdepot. Ein Eintrag „alles zusammen" fehlt mit Absicht: Das wäre wieder
 * die Zahl, die Übung und Ernst vermischt.
 */
export function PortfolioSwitcher({
  portfolios,
  scope,
}: {
  portfolios: PortfolioRow[]
  scope: Scope
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const aktiv = portfolios.filter((p) => p.archivedAt == null)
  const archiviert = portfolios.filter((p) => p.archivedAt != null)
  const gewaehlt = scope.type === 'depot' ? portfolios.find((p) => p.id === scope.portfolioId) : null

  function waehle(next: Scope) {
    setOpen(false)
    if (formatScope(next) === formatScope(scope)) return
    startTransition(async () => {
      await setActiveScope(formatScope(next))
      router.refresh()
    })
  }

  const label = gewaehlt ? gewaehlt.name : 'Alle Echtgeld-Depots'
  const istDemo = gewaehlt != null && normalizePortfolioKind(gewaehlt.kind) === 'demo'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex h-9 max-w-[13rem] items-center gap-2 rounded-lg border px-2.5 text-sm transition-colors',
          'border-border bg-background hover:bg-accent disabled:opacity-60',
          // Ein Übungsdepot ist am Umschalter selbst zu erkennen — nicht erst an
          // einem Abzeichen weiter unten auf der Seite.
          istDemo && 'border-[color-mix(in_oklab,var(--warning)_45%,transparent)]',
        )}
        title={
          istDemo
            ? 'Übungsdepot: Alle Beträge sind Papiergeld und zählen in keine Echtgeld-Kennzahl.'
            : 'Depot wählen — bestimmt die angezeigten Zahlen und das Ziel neuer Trades.'
        }
      >
        {gewaehlt ? (
          istDemo ? (
            <FlaskConical className="size-4 shrink-0 text-[var(--warning)]" aria-hidden />
          ) : (
            <Landmark className="size-4 shrink-0 text-positive" aria-hidden />
          )
        ) : (
          <Layers className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="truncate font-medium">{label}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {open && (
        <>
          {/* Klick daneben schließt. Bewusst kein Modal — der Umschalter darf den
              Blick auf die Zahlen nicht verdecken. */}
          <button
            type="button"
            aria-label="Schließen"
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="listbox"
            className="panel-raised absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-lg border border-border p-1 shadow-lg"
          >
            <Eintrag
              icon={<Layers className="size-4 text-muted-foreground" aria-hidden />}
              label="Alle Echtgeld-Depots"
              hint="Zusammenfassung — Übungsdepots sind nie enthalten."
              active={scope.type === 'alleEchtgeld'}
              onClick={() => waehle({ type: 'alleEchtgeld' })}
            />

            <Trenner />

            {aktiv.map((p) => (
              <DepotEintrag
                key={p.id}
                p={p}
                active={gewaehlt?.id === p.id}
                onClick={() => waehle({ type: 'depot', portfolioId: p.id })}
              />
            ))}

            {archiviert.length > 0 && (
              <>
                <Trenner label="Archiv" />
                {archiviert.map((p) => (
                  <DepotEintrag
                    key={p.id}
                    p={p}
                    active={gewaehlt?.id === p.id}
                    onClick={() => waehle({ type: 'depot', portfolioId: p.id })}
                  />
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function DepotEintrag({
  p,
  active,
  onClick,
}: {
  p: PortfolioRow
  active: boolean
  onClick: () => void
}) {
  const demo = normalizePortfolioKind(p.kind) === 'demo'
  return (
    <Eintrag
      icon={
        demo ? (
          <FlaskConical className="size-4 text-[var(--warning)]" aria-hidden />
        ) : (
          <Landmark className="size-4 text-positive" aria-hidden />
        )
      }
      label={p.name}
      hint={demo ? 'Übungsgeld — zählt in keine Echtgeld-Kennzahl.' : 'Echtes Geld.'}
      active={active}
      archived={p.archivedAt != null}
      onClick={onClick}
    />
  )
}

function Eintrag({
  icon,
  label,
  hint,
  active,
  archived,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  active: boolean
  archived?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
        'hover:bg-accent',
        active && 'bg-accent',
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate text-sm font-medium', archived && 'text-muted-foreground')}>
            {label}
          </span>
          {archived && <span className="eyebrow shrink-0">archiviert</span>}
        </span>
        <span className="note mt-0.5 block">{hint}</span>
      </span>
      {active && <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />}
    </button>
  )
}

function Trenner({ label }: { label?: string }) {
  if (!label) return <div className="my-1 h-px bg-border" />
  return (
    <div className="mt-2 mb-1 px-2.5">
      <span className="eyebrow">{label}</span>
    </div>
  )
}
