'use client'

// Kontrakt-Spezifikation am Instrument (Plan Demo-Handel, Teil 3).
//
// Zwei Dinge macht diese Karte sichtbar, die sonst unsichtbar blieben:
//
//   1. WAS gilt. Ein Instrument mit Spezifikation wird in Kontrakten bemessen,
//      und dann hängt jede Risikozahl an Tick-Größe und Tick-Wert. Wer das nicht
//      sieht, kann eine falsche Zahl nicht erkennen.
//   2. WOHER es kommt. Jedes Feld zeigt die Vorgabe als Platzhalter; was der
//      Nutzer einträgt, schlägt sie. Ein leeres Feld heisst „nimm die Vorgabe" —
//      nicht „nimm null".
//
// Der Abschalter unten ist der ehrliche Ausweg: Liegt die Wurzel-Erkennung
// daneben (`SI` ist auch eine Aktie), soll man sie abstellen können, statt mit
// dem 5.000-fachen Multiplikator zu rechnen.

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/form-frame'
import { updateContractSpec } from '@/app/actions/stocks'
import type { ContractSpec, ContractSpecOverride } from '@/lib/contract-specs'
import { Boxes, Save } from 'lucide-react'
import { toast } from 'sonner'

const inputCls = 'input-ocean h-11 font-mono'

const zahl = (v: number | null | undefined): string =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : ''

export function ContractSpecCard({
  stockId,
  ticker,
  spec,
  vorgabe,
  hand,
}: {
  stockId: number
  ticker: string
  /** Was gilt — Vorgabe plus Handeingabe. Null: dieses Instrument hat keine. */
  spec: ContractSpec | null
  /** Die Vorgabe allein, als Platzhalter. */
  vorgabe: ContractSpec | null
  /** Was am Instrument steht. */
  hand: ContractSpecOverride
}) {
  const [offen, setOffen] = useState(false)
  const [speichert, setSpeichert] = useState(false)
  const [f, setF] = useState({
    tickSize: zahl(hand.tickSize),
    tickValue: zahl(hand.tickValue),
    contractSize: zahl(hand.contractSize),
    currency: hand.currency ?? '',
    marginModel: hand.marginModel ?? '',
    initialMargin: zahl(hand.initialMargin),
    maintenanceMargin: zahl(hand.maintenanceMargin),
    maintenanceRate: zahl(hand.maintenanceRate),
    disabled: hand.disabled === true,
  })
  const set = (k: keyof typeof f, v: string | boolean) => setF((p) => ({ ...p, [k]: v }))

  const platzhalter = (v: number | null | undefined) =>
    typeof v === 'number' ? `Vorgabe: ${v}` : '—'

  const speichern = async () => {
    setSpeichert(true)
    try {
      const n = (s: string) => (s.trim() === '' ? null : parseFloat(s))
      await updateContractSpec(stockId, {
        tickSize: n(f.tickSize),
        tickValue: n(f.tickValue),
        contractSize: n(f.contractSize),
        currency: f.currency.trim() || null,
        marginModel: f.marginModel || null,
        initialMargin: n(f.initialMargin),
        maintenanceMargin: n(f.maintenanceMargin),
        maintenanceRate: n(f.maintenanceRate),
        disabled: f.disabled,
      })
      toast.success('Kontrakt-Spezifikation gespeichert.')
      setOffen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.')
    } finally {
      setSpeichert(false)
    }
  }

  const festesModell =
    (f.marginModel || vorgabe?.marginModel || 'fest') === 'fest'

  return (
    <div className="panel space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Boxes className="size-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="eyebrow">Kontrakt-Spezifikation</p>
            <p className="truncate font-medium">
              {spec ? spec.name : `${ticker} — wird nicht in Kontrakten gehandelt`}
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setOffen((o) => !o)}>
          {offen ? 'Schliessen' : 'Bearbeiten'}
        </Button>
      </div>

      {spec ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <Wert label="Tick-Größe" value={String(spec.tickSize)} />
          <Wert label={`Tick-Wert (${spec.currency})`} value={String(spec.tickValue)} />
          <Wert label="Kontraktgröße" value={String(spec.contractSize)} />
          <Wert
            label={`Einschuss (${spec.currency})`}
            value={
              spec.marginModel === 'fest'
                ? String(spec.initialMargin)
                : `Kontraktwert ÷ Hebel`
            }
          />
        </dl>
      ) : (
        <p className="note">
          Für dieses Instrument gilt keine Spezifikation — Trades rechnen wie bisher über
          Kapitaleinsatz und Stückzahl. Das ist der Normalfall für Aktien, ETFs und
          Spot-Krypto.
        </p>
      )}

      {offen && (
        <div className="space-y-4 border-t border-border pt-4">
          <p className="note">
            Leere Felder heissen „nimm die Vorgabe". Was hier steht, gilt statt ihr — die
            Börsen ändern Einschüsse mehrmals im Jahr, und was dein Broker verlangt, weisst
            nur du.
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Tick-Größe">
              <Input
                type="number"
                step="any"
                min="0"
                value={f.tickSize}
                onChange={(e) => set('tickSize', e.target.value)}
                placeholder={platzhalter(vorgabe?.tickSize)}
                className={inputCls}
              />
            </Field>
            <Field label="Tick-Wert">
              <Input
                type="number"
                step="any"
                min="0"
                value={f.tickValue}
                onChange={(e) => set('tickValue', e.target.value)}
                placeholder={platzhalter(vorgabe?.tickValue)}
                className={inputCls}
              />
            </Field>
            <Field label="Kontraktgröße">
              <Input
                type="number"
                step="any"
                min="0"
                value={f.contractSize}
                onChange={(e) => set('contractSize', e.target.value)}
                placeholder={platzhalter(vorgabe?.contractSize)}
                className={inputCls}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Währung">
              <Input
                value={f.currency}
                onChange={(e) => set('currency', e.target.value.toUpperCase())}
                placeholder={vorgabe?.currency ? `Vorgabe: ${vorgabe.currency}` : 'z. B. USD'}
                className={inputCls}
                maxLength={5}
              />
            </Field>
            <Field label="Einschuss-Modell">
              <select
                value={f.marginModel}
                onChange={(e) => set('marginModel', e.target.value)}
                className="input-ocean h-11 w-full rounded-lg px-2.5 font-mono text-sm"
              >
                <option value="">
                  {vorgabe ? `Vorgabe: ${vorgabe.marginModel}` : 'fest'}
                </option>
                <option value="fest">fest (Betrag je Kontrakt)</option>
                <option value="notional">notional (Kontraktwert ÷ Hebel)</option>
              </select>
            </Field>
            {festesModell ? (
              <Field label="Einschuss je Kontrakt">
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={f.initialMargin}
                  onChange={(e) => set('initialMargin', e.target.value)}
                  placeholder={platzhalter(
                    vorgabe?.marginModel === 'fest' ? vorgabe.initialMargin : null,
                  )}
                  className={inputCls}
                />
              </Field>
            ) : (
              <Field label="Erhaltungssatz (Anteil, z. B. 0.005)">
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={f.maintenanceRate}
                  onChange={(e) => set('maintenanceRate', e.target.value)}
                  placeholder={platzhalter(
                    vorgabe?.marginModel === 'notional' ? vorgabe.maintenanceRate : null,
                  )}
                  className={inputCls}
                />
              </Field>
            )}
          </div>

          {festesModell && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field label="Einschuss halten je Kontrakt">
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={f.maintenanceMargin}
                  onChange={(e) => set('maintenanceMargin', e.target.value)}
                  placeholder={platzhalter(
                    vorgabe?.marginModel === 'fest' ? vorgabe.maintenanceMargin : null,
                  )}
                  className={inputCls}
                />
              </Field>
            </div>
          )}

          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={f.disabled}
              onChange={(e) => set('disabled', e.target.checked)}
              className="mt-1"
            />
            <span>
              Dieses Instrument handle ich <strong>nicht</strong> in Kontrakten.
              <span className="note block">
                Schaltet auch die Vorgabe ab. Der Ausweg, wenn die Erkennung über die
                Kontrakt-Wurzel danebenliegt — {ticker} ist womöglich ein Wertpapier und
                kein Terminkontrakt.
              </span>
            </span>
          </label>

          <Button type="button" onClick={() => void speichern()} disabled={speichert}>
            <Save className="size-4" />
            {speichert ? 'Speichert …' : 'Speichern'}
          </Button>
        </div>
      )}
    </div>
  )
}

function Wert({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="font-mono text-sm">{value}</dd>
    </div>
  )
}
