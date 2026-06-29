'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AddAssessmentDialog } from '@/components/add-assessment-dialog'
import { deleteAssessment } from '@/app/actions/stocks'
import type { AssessmentEntry } from '@/app/actions/stocks'
import { Check, ListChecks, Plus, Target, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function AssessmentList({
  stockId,
  stockName,
  assessments,
}: {
  stockId: number
  stockName: string
  assessments: AssessmentEntry[]
}) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const handleDelete = async (entry: AssessmentEntry) => {
    if (!confirm('Diesen Eintrag wirklich löschen?')) return
    setDeletingId(entry.id)
    try {
      await deleteAssessment(entry.id)
      toast.success('Eintrag gelöscht')
      router.refresh()
    } catch {
      toast.error('Löschen fehlgeschlagen.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListChecks className="size-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Erfasste Einträge
            </h3>
            <p className="text-xs text-muted-foreground">
              Alle Einschätzungen zu dieser Aktie
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
          <Plus className="size-3.5" />
          <span className="hidden sm:inline">Einschätzung</span>
        </Button>
      </div>

      {assessments.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <ListChecks className="size-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-foreground">
            Noch keine Einträge
          </p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            Erfasse oben deine erste Einschätzung zu dieser Aktie.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {assessments.map((entry) => (
            <li
              key={entry.id}
              className="group flex items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-accent/40"
            >
              <span
                className={
                  entry.zoneNotReached
                    ? 'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-warning/10 text-warning'
                    : entry.isCorrect
                      ? 'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-positive/10 text-positive'
                      : 'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-negative/10 text-negative'
                }
              >
                {entry.zoneNotReached ? (
                  <Target className="size-4" />
                ) : entry.isCorrect ? (
                  <Check className="size-4" />
                ) : (
                  <X className="size-4" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="secondary"
                    className={
                      entry.zoneNotReached
                        ? 'text-[10px] text-warning'
                        : entry.isCorrect
                          ? 'text-[10px] text-positive'
                          : 'text-[10px] text-negative'
                    }
                  >
                    {entry.zoneNotReached
                      ? 'Zone nicht angelaufen'
                      : entry.isCorrect
                        ? 'Richtig'
                        : 'Falsch'}
                  </Badge>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatDate(entry.assessmentDate)}
                  </span>
                </div>
                {entry.note && (
                  <p className="mt-1 text-pretty text-sm text-foreground">
                    {entry.note}
                  </p>
                )}
              </div>

              <Button
                size="icon"
                variant="ghost"
                className="size-8 shrink-0 text-muted-foreground hover:text-negative"
                onClick={() => handleDelete(entry)}
                disabled={deletingId === entry.id}
                aria-label="Eintrag löschen"
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AddAssessmentDialog
        stockId={stockId}
        stockName={stockName}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </Card>
  )
}
