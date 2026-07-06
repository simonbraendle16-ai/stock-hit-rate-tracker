'use client'

import type React from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addStock } from '@/app/actions/stocks'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'

export function AddStockDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [ticker, setTicker] = useState('')
  const [market, setMarket] = useState('aktien')
  const [chartUrl, setChartUrl] = useState('')
  const [section, setSection] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await addStock({ name, ticker, market, chartUrl, section })
      toast.success(`${name.trim()} hinzugefügt`)
      setName('')
      setTicker('')
      setMarket('aktien')
      setChartUrl('')
      setSection('')
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Aktie konnte nicht angelegt werden.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="size-4" />
        Aktie hinzufügen
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Neue Aktie</DialogTitle>
          <DialogDescription>
            Lege eine Aktie an, für die du deine Analyse-Treffer erfassen
            möchtest.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="stock-name">Name</Label>
            <Input
              id="stock-name"
              placeholder="z. B. Apple"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="stock-ticker">Ticker-Symbol</Label>
            <Input
              id="stock-ticker"
              placeholder="z. B. AAPL"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              required
              className="uppercase"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="stock-market">Markt</Label>
            <select
              id="stock-market"
              value={market}
              onChange={(e) => setMarket(e.target.value)}
              className="input-ocean h-11 w-full rounded-lg px-2.5 font-mono text-sm"
            >
              {[
                ['aktien', 'Aktien'],
                ['krypto', 'Krypto'],
                ['forex', 'Forex'],
                ['rohstoffe', 'Rohstoffe'],
                ['etf', 'ETF'],
                ['optionen', 'Optionen'],
                ['sonstiges', 'Sonstiges'],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Bestimmt die Kursdaten-Quelle des eingebetteten Charts.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="stock-section">Watchlist-Sektion (optional)</Label>
            <Input
              id="stock-section"
              placeholder="z. B. China, Minen, KI …"
              value={section}
              onChange={(e) => setSection(e.target.value)}
              maxLength={40}
            />
            <p className="text-xs text-muted-foreground">
              Gruppiert das Instrument in der Watchlist (wie TradingView-Sektionen).
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="stock-chart-url">Chart-Link (optional)</Label>
            <Input
              id="stock-chart-url"
              type="url"
              inputMode="url"
              placeholder="z. B. https://www.tradingview.com/chart/?symbol=AAPL"
              value={chartUrl}
              onChange={(e) => setChartUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Direkter Link zum Chart, um ihn später mit einem Klick zu öffnen.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading} className="w-full sm:w-auto">
              {loading ? 'Wird gespeichert...' : 'Aktie anlegen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
