'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Field,
  FormSection,
  ChoiceButton,
  InlineNotice,
  ResultBlock,
  ResultRow,
} from '@/components/form-frame'
import { computeRiskReward } from '@/lib/trade-math'
import { SetupTagsInput } from '@/components/setup-tags-input'
import { commitTrainingTrade } from '@/app/actions/training-trades'
import {
  TRAINING_DIRECTIONS,
  requiresElliott,
  type TrainingDirection,
  type TrainingMode,
} from '@/lib/training'
import {
  validateTradeDraft,
  type PickField,
  type TrainingTradeView,
} from '@/lib/training-trade'
import { AlertTriangle, Crosshair, Lock } from 'lucide-react'
import { toast } from 'sonner'

function zahl(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Kurse zum Weiterarbeiten runden.
 *
 * Ein Schlusskurs kommt als `64128.351563` an — damit kann niemand rechnen und
 * niemand tippt das ab. Die Genauigkeit richtet sich nach der Größenordnung,
 * damit Aktien, Indizes, Krypto und Forex gleichermaßen brauchbar sind
 * (`1.0842` braucht vier Stellen, `64128,35` nicht).
 */
function alsKurs(v: number): string {
  const betrag = Math.abs(v)
  const stellen = betrag >= 100 ? 2 : betrag >= 1 ? 4 : 6
  return String(Number(v.toFixed(stellen)))
}

/**
 * Ein geübter Trade — geplant VOR dem Weiterlaufen.
 *
 * Einstieg, Stop und Ziel sind Pflicht, sobald eine Richtung steht. Nicht aus
 * Formstrenge: Ohne sie kann die App nicht messen, ob Stop oder Ziel zuerst
 * kam, und die Bewertung fiele auf das eigene Gefühl nach dem Aufdecken
 * zurück. Es ist dieselbe Regel wie im Ernstfall — Risiko steht vor dem
 * Einstieg fest.
 */
export function TradePlanForm({
  sessionId,
  mode,
  entryCandleTime,
  currentPrice,
  pickField,
  pickedPrice,
  onPickField,
  onCommitted,
  onCancel,
}: {
  sessionId: number
  mode: TrainingMode
  /** Letzte sichtbare Kerze — Beleg und Startpunkt der Messung. */
  entryCandleTime: number | null
  /** Schlusskurs der letzten sichtbaren Kerze — Ausgangspunkt für den Einstieg. */
  currentPrice: number | null
  /**
   * Welches Feld gerade aus dem Chart aufgenommen wird. Der Zustand liegt
   * oben im Arbeitsplatz, weil Chart und Formular ihn beide brauchen —
   * zwei Kopien wären zwei Meinungen darüber, worauf der nächste Klick geht.
   */
  pickField: PickField | null
  /** Der zuletzt im Chart angeklickte Kurs — wird ins offene Feld übernommen. */
  pickedPrice: { field: PickField; price: number } | null
  onPickField: (f: PickField | null) => void
  onCommitted: (trade: TrainingTradeView) => void
  onCancel?: () => void
}) {
  const [direction, setDirection] = useState<TrainingDirection>('long')
  // Vorbelegt mit dem Kurs, der gerade sichtbar ist. Nicht aus Bequemlichkeit:
  // Wer ihn abtippen muss, schaut auf die OHLC-Zeile statt auf den Chart — und
  // vertippt sich in der Stelle, an der er die Struktur lesen sollte.
  const [entry, setEntry] = useState(currentPrice != null ? alsKurs(currentPrice) : '')
  const [stop, setStop] = useState('')
  const [target, setTarget] = useState('')
  const [invalidation, setInvalidation] = useState('')
  const [elliott, setElliott] = useState('')
  const [setupTags, setSetupTags] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  // Ein im Chart angeklickter Kurs landet im angeforderten Feld. Die Aufnahme
  // endet danach von selbst — wer drei Level setzen will, wählt drei Mal, statt
  // versehentlich dasselbe Feld zu überschreiben.
  useEffect(() => {
    if (!pickedPrice) return
    const wert = alsKurs(pickedPrice.price)
    if (pickedPrice.field === 'entry') setEntry(wert)
    else if (pickedPrice.field === 'stop') setStop(wert)
    else setTarget(wert)
    onPickField(null)
  }, [pickedPrice, onPickField])

  const draft = {
    direction,
    entryPrice: zahl(entry),
    stopLoss: zahl(stop),
    takeProfit: zahl(target),
    elliottCount: elliott.trim() || null,
    invalidation: zahl(invalidation),
    thesisNote: note.trim() || null,
    setupTags,
  }

  // Dieselbe Funktion wie auf dem Server — zwei Prüfungen wären zwei Meinungen
  // darüber, was ein gültiger Plan ist.
  const fehler = validateTradeDraft(draft, mode)
  const bereit = fehler.length === 0

  const { entryPrice: e, stopLoss: s, takeProfit: z } = draft
  const crv = e != null && s != null && z != null && e !== s ? computeRiskReward(e, s, z) : null
  const stopAbstand = e != null && s != null && e > 0 ? (Math.abs(e - s) / e) * 100 : null

  async function speichern() {
    if (!bereit) return
    setSaving(true)
    try {
      const res = await commitTrainingTrade({ sessionId, ...draft, entryCandleTime })
      if (!res.ok) {
        toast.error(res.errors.join(' '))
        return
      }
      onCommitted(res.trade)
    } catch {
      toast.error('Konnte nicht gespeichert werden.')
    } finally {
      setSaving(false)
    }
  }

  const handelt = direction !== 'keine'

  return (
    <FormSection
      icon={Lock}
      title="Trade planen"
      hint="Was du hier festlegst, steht fest — der Replay läuft danach weiter."
    >
      <Field label="Richtung">
        <div className="flex flex-wrap gap-1.5">
          {TRAINING_DIRECTIONS.map((d) => (
            <ChoiceButton
              key={d.id}
              active={direction === d.id}
              onClick={() => setDirection(d.id)}
            >
              {d.label}
            </ChoiceButton>
          ))}
        </div>
      </Field>

      {direction === 'keine' && (
        <InlineNotice tone="neutral">
          Kein Setup zu sehen ist ein Ergebnis, kein Aussetzer. Es zählt als
          Enthaltung — nicht als verlorener Trade.
        </InlineNotice>
      )}

      {handelt && (
        <>
          {/* Jedes Level lässt sich tippen ODER im Chart anklicken. Das
              Anklicken ist der eigentliche Weg: Man setzt den Stop dorthin, wo
              die Struktur ihn verlangt, und sieht dabei den Abstand — statt ihn
              aus der Achse abzulesen und abzutippen. */}
          {/* Untereinander statt nebeneinander: Neben dem Chart ist das Panel
              schmal, und drei Kursfelder plus Knopf in einer Zeile schneiden
              die Zahlen ab — ein Kurs, den man nicht lesen kann, ist schlimmer
              als eine Zeile mehr. */}
          <div className="space-y-1.5">
            {(
              [
                ['entry', 'Einstieg', entry, setEntry],
                ['stop', 'Stop', stop, setStop],
                ['target', 'Ziel', target, setTarget],
              ] as const
            ).map(([feld, label, wert, setzen]) => (
              <label key={feld} className="flex items-center gap-2">
                <span className="w-16 shrink-0 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {label}
                </span>
                <Input
                  value={wert}
                  onChange={(e) => setzen(e.target.value)}
                  inputMode="decimal"
                  placeholder="Pflicht"
                  className="h-9 min-w-0 flex-1 font-mono text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  variant={pickField === feld ? 'secondary' : 'ghost'}
                  className="h-9 w-9 shrink-0 p-0"
                  title={`${label} im Chart anklicken`}
                  aria-label={`${label} im Chart anklicken`}
                  onClick={() => onPickField(pickField === feld ? null : feld)}
                >
                  <Crosshair className="size-3.5" />
                </Button>
              </label>
            ))}
            <p className="note">
              Tippen oder das Fadenkreuz nehmen und die Höhe im Chart anklicken.
            </p>
          </div>

          {requiresElliott(mode) && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Wellenzählung (Pflicht)">
                <Input
                  value={elliott}
                  onChange={(e) => setElliott(e.target.value)}
                  placeholder="Welle 3, Impuls"
                  className="h-9 font-mono text-xs"
                />
              </Field>
              <Field label="Invalidation (Pflicht)">
                <Input
                  value={invalidation}
                  onChange={(e) => setInvalidation(e.target.value)}
                  inputMode="decimal"
                  placeholder="Kurs"
                  className="h-9 font-mono text-xs"
                />
              </Field>
            </div>
          )}

          {/* `SetupTagsInput` bringt Beschriftung und Hinweis selbst mit — ein
              eigenes `Field` darum ergäbe beides doppelt. */}
          <SetupTagsInput value={setupTags} onChange={setSetupTags} />

          <Field label="Begründung">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Struktur, Auslöser, Ungültigkeit ..."
              className="input-ocean w-full rounded-lg px-3 py-2 font-mono text-xs"
            />
          </Field>
        </>
      )}

      {/* Sofortige Rückmeldung auf den eigenen Plan.
          Das CRV ist die eine Zahl, die vor dem Einstieg zählt: Ein Setup mit
          0,5 R Chance auf 1 R Risiko ist auch dann schlecht, wenn es aufgeht.
          Gerechnet wird mit `computeRiskReward` aus `lib/trade-math.ts` —
          derselben Funktion wie beim echten Trade, nicht neu. */}
      {handelt && crv != null && (
        <ResultBlock>
          <ResultRow
            label="Chance / Risiko"
            value={`${crv.toLocaleString('de-DE', { maximumFractionDigits: 2 })} : 1`}
            // Unter 1:1 riskiert man mehr, als zu holen ist — das gehört
            // sichtbar gemacht, nicht kommentiert.
            tone={crv >= 2 ? 'positive' : crv >= 1 ? 'neutral' : 'destructive'}
          />
          <ResultRow
            label="Abstand zum Stop"
            value={`${stopAbstand!.toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`}
          />
        </ResultBlock>
      )}

      {!bereit && fehler.length > 0 && (
        <p className="note flex items-start gap-1.5 text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{fehler.join(' ')}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          className="h-9 gap-1.5 px-3"
          disabled={!bereit || saving}
          onClick={speichern}
        >
          <Lock className="size-3.5" />
          {handelt ? 'Trade festschreiben' : 'Enthaltung festhalten'}
        </Button>
        {onCancel && (
          <Button
            size="sm"
            variant="ghost"
            className="h-9 px-3 font-mono text-[11px] text-muted-foreground"
            disabled={saving}
            onClick={onCancel}
          >
            Zurück
          </Button>
        )}
      </div>
    </FormSection>
  )
}
