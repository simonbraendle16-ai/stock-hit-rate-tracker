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
  const [chartUrl, setChartUrl] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await addStock({ name, ticker, chartUrl })
      toast.success(`${name.trim()} hinzugefügt`)
      setName('')
      setTicker('')
      setChartUrl('')
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
