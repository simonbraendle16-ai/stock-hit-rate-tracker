'use client'

import type React from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { updateSettings, type UserSettings } from '@/app/actions/settings'
import { Wallet, ShieldAlert, Coins } from 'lucide-react'
import { toast } from 'sonner'
import { currencySymbol, SUPPORTED_CURRENCIES } from '@/lib/format'
import { CurrencyChangeDialog } from '@/components/currency-change-dialog'
import { Field, FormSection } from '@/components/form-frame'

const inputCls = 'input-ocean h-11 font-mono'

/**
 * Die KONTOWEITEN Einstellungen (Etappe 12): Währung und Risiko-Vorgaben.
 *
 * Startkapital und Standardgebühren sind hier bewusst nicht mehr zu finden — sie
 * stehen am Depot und werden in `PortfolioManager` gepflegt. Sie an zwei Orten
 * einstellbar zu lassen hätte einen zweiten, veralteten Wert erzeugt, den
 * irgendwann jemand ausliest.
 *
 * Die Währung bleibt global: Ein Aggregat über Depots verschiedener Währung wäre
 * keine gültige Summe, weil die App bewusst nicht umrechnet.
 */
export function SettingsForm({ initial }: { initial: UserSettings }) {
  const router = useRouter()
  const [defaultRiskPct, setDefaultRiskPct] = useState(String(initial.defaultRiskPct))
  const [maxRiskPct, setMaxRiskPct] = useState(String(initial.maxRiskPct))
  const [currency, setCurrency] = useState(initial.currency)
  const [currencyDialogOpen, setCurrencyDialogOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    // Ein Währungswechsel betrifft bestehende Beträge — das wird nicht beiläufig
    // beim Speichern erledigt, sondern ausdrücklich bestätigt.
    if (currency !== initial.currency) {
      setCurrencyDialogOpen(true)
      return
    }
    setLoading(true)
    try {
      await updateSettings({
        defaultRiskPct: parseFloat(defaultRiskPct),
        maxRiskPct: parseFloat(maxRiskPct),
        currency,
      })
      toast.success('Einstellungen gespeichert')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <FormSection
        icon={Wallet}
        title="Währung"
        hint="Gilt für alle Depots gemeinsam — nur so bleibt eine Summe über Depots gültig."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Kontowährung">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="input-ocean h-11 w-full rounded-lg px-2.5 font-mono text-sm"
            >
              {SUPPORTED_CURRENCIES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="note">
          Kurse (Einstieg, Stop, Ziel) notieren weiterhin in der Währung des Instruments.
          Startkapital und Gebühren stehen bei den Depots weiter unten.
        </p>
      </FormSection>

      <FormSection
        icon={ShieldAlert}
        title="Risiko"
        hint="Wie viel des Kontos ein einzelner Stop kosten darf."
        delay="rise-in-1"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Standard-Risiko je Trade (%)">
            <Input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={defaultRiskPct}
              onChange={(e) => setDefaultRiskPct(e.target.value)}
              className={inputCls}
              required
            />
          </Field>
          <Field label="Warnschwelle max. Risiko (%)" tone="warning">
            <Input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={maxRiskPct}
              onChange={(e) => setMaxRiskPct(e.target.value)}
              className={inputCls}
              required
            />
          </Field>
        </div>
        <p className="note">
          Beim Planen eines Trades zeigt das Formular, wie viel Prozent des Depotkapitals der
          Stop-Loss riskiert — und warnt oberhalb der Schwelle. Das gilt auch im Übungsdepot,
          gemessen an seinem Papier-Startkapital: Wer die Positionsgröße ohne Bremse übt, übt
          ein, wovor die Bremse später schützen soll.
        </p>
      </FormSection>

      <Button
        type="submit"
        disabled={loading}
        className="btn-teal-glow h-11 font-mono text-sm font-bold tracking-wider"
      >
        {loading ? 'WIRD GESPEICHERT…' : 'SPEICHERN'}
      </Button>

      <CurrencyChangeDialog
        open={currencyDialogOpen}
        onOpenChange={(v) => {
          setCurrencyDialogOpen(v)
          // Abgebrochen → Auswahl zurücksetzen, damit die Anzeige nicht lügt.
          if (!v) setCurrency(initial.currency)
        }}
        from={initial.currency}
        to={currency}
        otherSettings={{
          defaultRiskPct: parseFloat(defaultRiskPct),
          maxRiskPct: parseFloat(maxRiskPct),
        }}
      />
    </form>
  )
}
