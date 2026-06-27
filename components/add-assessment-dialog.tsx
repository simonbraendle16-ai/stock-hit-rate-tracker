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
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addAssessment } from '@/app/actions/stocks'
import { Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function AddAssessmentDialog({
  stockId,
  stockName,
  open,
  onOpenChange,
}: {
  stockId: number
  stockName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null)
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [direction, setDirection] = useState<'long' | 'short' | null>(null)
  const [elliottCount, setElliottCount] = useState('')
  const [loading, setLoading] = useState(false)

  const reset = () => {
    setIsCorrect(null)
    setDate(today())
    setNote('')
    setDirection(null)
    setElliottCount('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isCorrect === null) {
      toast.error('Bitte wähle „Richtig“ oder „Falsch“.')
      return
    }
    setLoading(true)
    try {
      await addAssessment({
        stockId,
        isCorrect,
        note,
        assessmentDate: new Date(date).toISOString(),
        predictedDirection: direction,
        elliottCount,
      })
      toast.success('Einschätzung erfasst')
      reset()
      onOpenChange(false)
      router.refresh()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Speichern fehlgeschlagen.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) reset()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Einschätzung erfassen</DialogTitle>
          <DialogDescription>
            Wie lag deine Analyse zu{' '}
            <span className="font-medium text-foreground">{stockName}</span>?
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setIsCorrect(true)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg border-2 px-4 py-4 transition-colors',
                isCorrect === true
                  ? 'border-positive bg-positive/10 text-positive'
                  : 'border-border text-muted-foreground hover:border-positive/50',
              )}
            >
              <Check className="size-6" />
              <span className="text-sm font-medium">Richtig</span>
            </button>
            <button
              type="button"
              onClick={() => setIsCorrect(false)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg border-2 px-4 py-4 transition-colors',
                isCorrect === false
                  ? 'border-negative bg-negative/10 text-negative'
                  : 'border-border text-muted-foreground hover:border-negative/50',
              )}
            >
              <X className="size-6" />
              <span className="text-sm font-medium">Falsch</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label>Richtung (optional)</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDirection((d) => (d === 'long' ? null : 'long'))}
                  className={cn(
                    'rounded-lg border py-2 font-mono text-xs uppercase transition-colors',
                    direction === 'long'
                      ? 'border-positive/50 bg-positive/10 text-positive'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  Long
                </button>
                <button
                  type="button"
                  onClick={() => setDirection((d) => (d === 'short' ? null : 'short'))}
                  className={cn(
                    'rounded-lg border py-2 font-mono text-xs uppercase transition-colors',
                    direction === 'short'
                      ? 'border-negative/50 bg-negative/10 text-negative'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  Short
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="assessment-elliott">Wellenzählung (optional)</Label>
              <Input
                id="assessment-elliott"
                value={elliottCount}
                onChange={(e) => setElliottCount(e.target.value)}
                placeholder="z. B. Welle 3 von (3)"
                className="font-mono"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="assessment-date">Datum der Einschätzung</Label>
            <Input
              id="assessment-date"
              type="date"
              value={date}
              max={today()}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="assessment-note">Notiz / Begründung (optional)</Label>
            <textarea
              id="assessment-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Worauf basierte deine Analyse?"
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading} className="w-full sm:w-auto">
              {loading ? 'Wird gespeichert...' : 'Erfassen'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
