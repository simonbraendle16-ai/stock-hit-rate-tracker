'use client'

import type React from 'react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateStockChartUrl } from '@/app/actions/stocks'
import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

export function EditChartUrlDialog({
  stockId,
  stockName,
  chartUrl,
  open,
  onOpenChange,
}: {
  stockId: number
  stockName: string
  chartUrl: string | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const router = useRouter()
  const [value, setValue] = useState(chartUrl ?? '')
  const [loading, setLoading] = useState(false)

  // Bei jedem Öffnen den aktuellen Wert übernehmen.
  useEffect(() => {
    if (open) setValue(chartUrl ?? '')
  }, [open, chartUrl])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await updateStockChartUrl(stockId, value)
      toast.success(value.trim() ? 'Chart-Link gespeichert' : 'Chart-Link entfernt')
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Chart-Link konnte nicht gespeichert werden.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Chart-Link — {stockName}</DialogTitle>
          <DialogDescription>
            Hinterlege einen direkten Link zum Chart (z. B. TradingView), um ihn mit
            einem Klick zu öffnen. Leer lassen und speichern, um ihn zu entfernen.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`chart-url-${stockId}`}>Chart-Link</Label>
            <Input
              id={`chart-url-${stockId}`}
              type="url"
              inputMode="url"
              placeholder="z. B. https://www.tradingview.com/chart/?symbol=AAPL"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
            {chartUrl && (
              <a
                href={chartUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="size-3" /> Aktuellen Chart öffnen
              </a>
            )}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading} className="w-full sm:w-auto">
              {loading ? 'Wird gespeichert...' : 'Speichern'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
