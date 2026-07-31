'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ChoiceButton, Field, FormSection, InlineNotice } from '@/components/form-frame'
import { PaperBadge } from '@/components/paper-badge'
import {
  Archive,
  ArchiveRestore,
  Banknote,
  Check,
  FlaskConical,
  Landmark,
  Pencil,
  Plus,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { currencySymbol } from '@/lib/format'
import {
  archivePortfolio,
  createPortfolio,
  deletePortfolio,
  renamePortfolio,
  unarchivePortfolio,
  updatePortfolioMoney,
} from '@/app/actions/portfolios'
import {
  MAX_PORTFOLIO_NAME,
  normalizePortfolioKind,
  type PortfolioKind,
  type PortfolioRow,
} from '@/lib/portfolio-scope'
import { cn } from '@/lib/utils'

const inputCls = 'input-ocean h-11 font-mono'

/**
 * Depot-Verwaltung (Etappe 12) — der Ort, an dem Startkapital und Gebühren
 * jetzt leben.
 *
 * Sie standen bis hierher in den kontoweiten Einstellungen. Das ging nur so
 * lange, wie es genau ein Konto gab. Mit Depots gehören sie an das Depot: Zwei
 * Broker kosten verschieden, und ein Übungsdepot braucht ein eigenes
 * Papier-Startkapital, damit die Übung überhaupt eine Bilanz hat.
 *
 * Die Regeln (Namen, Löschen, Archivieren, Art-Änderung) stehen rein und getestet
 * in `lib/portfolio-scope.ts`; hier werden nur die Aktionen aufgerufen. Die
 * Fehlersätze kommen vom Server, damit Oberfläche und Serveraktion nie
 * unterschiedliche Auskunft geben.
 */
export function PortfolioManager({
  portfolios,
  usage,
  currency,
}: {
  portfolios: PortfolioRow[]
  /** Wie viele Trades in welchem Depot liegen — entscheidet über Löschen. */
  usage: { portfolioId: number; trades: number; open: number }[]
  currency: string
}) {
  const [anlegen, setAnlegen] = useState(false)
  const sym = currencySymbol(currency)

  const aktiv = portfolios.filter((p) => p.archivedAt == null)
  const archiviert = portfolios.filter((p) => p.archivedAt != null)
  const anzahl = (id: number) => usage.find((u) => u.portfolioId === id)?.trades ?? 0

  return (
    <FormSection
      icon={Wallet}
      title="Depots"
      hint="Jedes Depot hat eigenes Kapital und eigene Gebühren. Das Depot bestimmt, ob ein Trade mit echtem Geld läuft."
      delay="rise-in-2"
    >
      <div className="flex flex-col gap-3">
        {aktiv.map((p) => (
          <DepotZeile key={p.id} p={p} trades={anzahl(p.id)} sym={sym} alle={portfolios} />
        ))}

        {archiviert.length > 0 && (
          <>
            <p className="eyebrow mt-2">Archiv</p>
            {archiviert.map((p) => (
              <DepotZeile key={p.id} p={p} trades={anzahl(p.id)} sym={sym} alle={portfolios} />
            ))}
          </>
        )}

        {anlegen ? (
          <NeuesDepot sym={sym} onFertig={() => setAnlegen(false)} />
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => setAnlegen(true)}
            className="h-11 font-mono text-xs"
          >
            <Plus className="size-4" /> DEPOT ANLEGEN
          </Button>
        )}
      </div>

      <p className="note">
        Ein Depot mit Trades wird nie gelöscht, sondern archiviert — die Historie bleibt lesbar.
        Die Art (Echtgeld oder Demo) steht nach dem ersten Trade fest, weil eine Änderung die
        Bilanz rückwirkend umschreiben würde.
      </p>
    </FormSection>
  )
}

function DepotZeile({
  p,
  trades,
  sym,
  alle,
}: {
  p: PortfolioRow
  trades: number
  sym: string
  alle: PortfolioRow[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [umbenennen, setUmbenennen] = useState(false)
  const [name, setName] = useState(p.name)
  const [startCapital, setStartCapital] = useState(String(p.startCapital))
  const [feeEntry, setFeeEntry] = useState(String(p.defaultFeeEntry))
  const [feeExit, setFeeExit] = useState(String(p.defaultFeeExit))

  const kind = normalizePortfolioKind(p.kind)
  const demo = kind === 'demo'
  const archiviert = p.archivedAt != null
  const letztesEchtgeld =
    !demo &&
    !archiviert &&
    alle.filter((x) => normalizePortfolioKind(x.kind) === 'echtgeld' && x.archivedAt == null)
      .length === 1

  const lauf = async (fn: () => Promise<unknown>, erfolg: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(erfolg)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  const geaendert =
    parseFloat(startCapital) !== p.startCapital ||
    parseFloat(feeEntry) !== p.defaultFeeEntry ||
    parseFloat(feeExit) !== p.defaultFeeExit

  return (
    <div
      className={cn(
        'panel-sunken flex flex-col gap-3 p-3',
        archiviert && 'opacity-70',
        demo && 'border-l-2 border-l-[color-mix(in_oklab,var(--warning)_55%,transparent)]',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {demo ? (
            <FlaskConical className="size-4 shrink-0 text-[var(--warning)]" aria-hidden />
          ) : (
            <Landmark className="size-4 shrink-0 text-positive" aria-hidden />
          )}
          {umbenennen ? (
            <div className="flex items-center gap-1">
              <Input
                value={name}
                maxLength={MAX_PORTFOLIO_NAME}
                onChange={(e) => setName(e.target.value)}
                className="input-ocean h-9 w-44 font-mono text-sm"
                autoFocus
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={busy}
                title="Namen speichern"
                onClick={() =>
                  lauf(async () => {
                    await renamePortfolio(p.id, name)
                    setUmbenennen(false)
                  }, 'Depot umbenannt.')
                }
              >
                <Check className="size-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                title="Abbrechen"
                onClick={() => {
                  setName(p.name)
                  setUmbenennen(false)
                }}
              >
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <>
              <span className="truncate font-medium">{p.name}</span>
              <button
                type="button"
                onClick={() => setUmbenennen(true)}
                className="text-muted-foreground transition-colors hover:text-foreground"
                title="Umbenennen"
              >
                <Pencil className="size-3.5" />
              </button>
              {demo && <PaperBadge size="compact" />}
              {archiviert && <span className="eyebrow">archiviert</span>}
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          <span className="font-mono text-[11px] text-muted-foreground">
            {trades} {trades === 1 ? 'Trade' : 'Trades'}
          </span>
          {archiviert ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={busy}
              title="Aus dem Archiv zurückholen"
              onClick={() => lauf(() => unarchivePortfolio(p.id), 'Depot zurückgeholt.')}
            >
              <ArchiveRestore className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={busy || letztesEchtgeld}
              title={
                letztesEchtgeld
                  ? 'Das letzte aktive Echtgeld-Depot kann nicht archiviert werden.'
                  : 'Archivieren — fällt aus Umschalter und Aggregat, Historie bleibt.'
              }
              onClick={() => lauf(() => archivePortfolio(p.id), 'Depot archiviert.')}
            >
              <Archive className="size-4" />
            </Button>
          )}
          {trades === 0 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={busy}
              title="Löschen (nur weil dieses Depot leer ist)"
              onClick={() => lauf(() => deletePortfolio(p.id), 'Depot gelöscht.')}
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={demo ? `Papier-Startkapital (${sym})` : `Startkapital (${sym})`}>
          <Input
            type="number"
            step="any"
            min="0"
            value={startCapital}
            onChange={(e) => setStartCapital(e.target.value)}
            className={inputCls}
          />
        </Field>
        {/* Im Übungsdepot sind Gebühren immer 0 — Papier kostet nichts. Das ist
            keine Vorbelegung, sondern die Regel, also gibt es kein Feld dafür. */}
        {demo ? (
          <div className="sm:col-span-2 flex items-end">
            <p className="note">
              Auf Papier fallen keine Gebühren an. Setze das Papier-Startkapital am besten
              gleich hoch wie dein echtes — nur dann sind die Prozentzahlen vergleichbar.
            </p>
          </div>
        ) : (
          <>
            <Field label={`Gebühr Kauf (${sym})`}>
              <Input
                type="number"
                step="any"
                min="0"
                value={feeEntry}
                onChange={(e) => setFeeEntry(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label={`Gebühr Verkauf (${sym})`}>
              <Input
                type="number"
                step="any"
                min="0"
                value={feeExit}
                onChange={(e) => setFeeExit(e.target.value)}
                className={inputCls}
              />
            </Field>
          </>
        )}
      </div>

      {geaendert && (
        <Button
          type="button"
          disabled={busy}
          className="h-10 self-start font-mono text-xs font-bold tracking-wider"
          onClick={() =>
            lauf(
              () =>
                updatePortfolioMoney({
                  id: p.id,
                  startCapital: parseFloat(startCapital),
                  defaultFeeEntry: parseFloat(feeEntry),
                  defaultFeeExit: parseFloat(feeExit),
                }),
              'Depot gespeichert.',
            )
          }
        >
          {busy ? 'WIRD GESPEICHERT…' : 'DEPOT SPEICHERN'}
        </Button>
      )}
    </div>
  )
}

function NeuesDepot({ sym, onFertig }: { sym: string; onFertig: () => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<PortfolioKind>('echtgeld')
  const [startCapital, setStartCapital] = useState('10000')
  const [feeEntry, setFeeEntry] = useState('9')
  const [feeExit, setFeeExit] = useState('9')

  const anlegen = async () => {
    setBusy(true)
    try {
      await createPortfolio({
        name,
        kind,
        startCapital: parseFloat(startCapital),
        defaultFeeEntry: parseFloat(feeEntry),
        defaultFeeExit: parseFloat(feeExit),
      })
      toast.success('Depot angelegt.')
      onFertig()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel-sunken flex flex-col gap-3 p-3">
      <p className="eyebrow">Neues Depot</p>

      <Field label="Name *">
        <Input
          value={name}
          maxLength={MAX_PORTFOLIO_NAME}
          onChange={(e) => setName(e.target.value)}
          placeholder="z. B. Comdirect, Trade Republic, Übung Scalping"
          className={inputCls}
          autoFocus
        />
      </Field>

      <Field
        label="Art *"
        as="div"
        hint="Nach dem ersten Trade nicht mehr änderbar — eine Änderung würde die Bilanz rückwirkend umschreiben."
      >
        <div className="grid grid-cols-2 gap-2">
          <ChoiceButton
            active={kind === 'echtgeld'}
            tone="positive"
            icon={Banknote}
            onClick={() => setKind('echtgeld')}
          >
            ECHTES GELD
          </ChoiceButton>
          <ChoiceButton
            active={kind === 'demo'}
            tone="warning"
            icon={FlaskConical}
            onClick={() => setKind('demo')}
          >
            ÜBUNG · PAPIER
          </ChoiceButton>
        </div>
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label={kind === 'demo' ? `Papier-Startkapital (${sym})` : `Startkapital (${sym})`}>
          <Input
            type="number"
            step="any"
            min="0"
            value={startCapital}
            onChange={(e) => setStartCapital(e.target.value)}
            className={inputCls}
          />
        </Field>
        {kind === 'echtgeld' && (
          <>
            <Field label={`Gebühr Kauf (${sym})`}>
              <Input
                type="number"
                step="any"
                min="0"
                value={feeEntry}
                onChange={(e) => setFeeEntry(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label={`Gebühr Verkauf (${sym})`}>
              <Input
                type="number"
                step="any"
                min="0"
                value={feeExit}
                onChange={(e) => setFeeExit(e.target.value)}
                className={inputCls}
              />
            </Field>
          </>
        )}
      </div>

      {kind === 'demo' && (
        <InlineNotice tone="warning" icon={FlaskConical}>
          Übungsdepot: Alle Beträge sind Papiergeld, Gebühren fallen keine an, und nichts daraus
          zählt in eine Echtgeld-Kennzahl oder wird mit Freunden geteilt.
        </InlineNotice>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          disabled={busy || !name.trim()}
          onClick={anlegen}
          className="h-10 font-mono text-xs font-bold tracking-wider"
        >
          {busy ? 'WIRD ANGELEGT…' : 'ANLEGEN'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onFertig}
          className="h-10 font-mono text-xs"
        >
          ABBRECHEN
        </Button>
      </div>
    </div>
  )
}
