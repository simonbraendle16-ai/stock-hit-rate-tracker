'use client'

import type React from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { updateSettings, type UserSettings } from '@/app/actions/settings'
import { Wallet, ShieldAlert, Coins } from 'lucide-react'
import { toast } from 'sonner'

const labelCls = 'font-mono text-[10px] tracking-widest uppercase text-primary/60'

export function SettingsForm({ initial }: { initial: UserSettings }) {
  const router = useRouter()
  const [startCapital, setStartCapital] = useState(String(initial.startCapital))
  const [defaultRiskPct, setDefaultRiskPct] = useState(String(initial.defaultRiskPct))
  const [maxRiskPct, setMaxRiskPct] = useState(String(initial.maxRiskPct))
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await updateSettings({
        startCapital: parseFloat(startCapital),
        defaultRiskPct: parseFloat(defaultRiskPct),
        maxRiskPct: parseFloat(maxRiskPct),
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
      <div className="glass-card space-y-4 p-5">
        <div className="flex items-center gap-2">
          <Wallet className="size-4 text-primary" />
          <p className="font-mono text-[10px] font-bold tracking-widest text-primary">KONTO</p>
        </div>
        <div className="space-y-2">
          <Label className={labelCls}>Startkapital (€)</Label>
          <Input
            type="number"
            step="any"
            min="0"
            value={startCapital}
            onChange={(e) => setStartCapital(e.target.value)}
            className="input-ocean h-11 font-mono"
            required
          />
          <p className="font-mono text-[11px] text-muted-foreground">
            Basis für Bilanz und Rendite. Nur Echtgeld-Trades verändern den Kontostand.
          </p>
        </div>
      </div>

      <div className="glass-card space-y-4 p-5">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-primary" />
          <p className="font-mono text-[10px] font-bold tracking-widest text-primary">RISIKO</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className={labelCls}>Standard-Risiko je Trade (%)</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={defaultRiskPct}
              onChange={(e) => setDefaultRiskPct(e.target.value)}
              className="input-ocean h-11 font-mono"
              required
            />
          </div>
          <div className="space-y-2">
            <Label className={labelCls}>Warnschwelle max. Risiko (%)</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              max="100"
              value={maxRiskPct}
              onChange={(e) => setMaxRiskPct(e.target.value)}
              className="input-ocean h-11 font-mono"
              required
            />
          </div>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">
          Beim Planen eines Echtgeld-Trades zeigt das Formular, wie viel Prozent des Kontos der
          Stop-Loss riskiert — und warnt oberhalb der Schwelle.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Coins className="size-4 text-muted-foreground" />
        <p className="font-mono text-[11px] text-muted-foreground">
          Ordergebühr fix: 9 € je Order (18 € Round-Trip).
        </p>
      </div>

      <Button
        type="submit"
        disabled={loading}
        className="btn-teal-glow h-11 font-mono text-sm font-bold tracking-wider"
      >
        {loading ? 'WIRD GESPEICHERT…' : 'SPEICHERN'}
      </Button>
    </form>
  )
}
