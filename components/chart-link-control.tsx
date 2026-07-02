'use client'

import { useState } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { EditChartUrlDialog } from '@/components/edit-chart-url-dialog'
import { ExternalLink, LineChart, Pencil } from 'lucide-react'

export function ChartLinkControl({
  stockId,
  stockName,
  chartUrl,
}: {
  stockId: number
  stockName: string
  chartUrl: string | null
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex items-center gap-1.5">
      {chartUrl ? (
        <>
          <a
            href={chartUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ size: 'sm', variant: 'outline' })}
          >
            <LineChart className="size-3.5" />
            Chart öffnen
            <ExternalLink className="size-3 opacity-60" />
          </a>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-muted-foreground"
            onClick={() => setOpen(true)}
            aria-label="Chart-Link bearbeiten"
          >
            <Pencil className="size-4" />
          </Button>
        </>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <LineChart className="size-3.5" />
          Chart-Link hinzufügen
        </Button>
      )}

      <EditChartUrlDialog
        stockId={stockId}
        stockName={stockName}
        chartUrl={chartUrl}
        open={open}
        onOpenChange={setOpen}
      />
    </div>
  )
}
