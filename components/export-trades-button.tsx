'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { exportTradesCsv } from '@/app/actions/trades'
import { Download } from 'lucide-react'
import { toast } from 'sonner'

export function ExportTradesButton() {
  const [busy, setBusy] = useState(false)

  const download = async () => {
    setBusy(true)
    try {
      const csv = await exportTradesCsv()
      // BOM, damit Excel UTF-8 (Umlaute) korrekt erkennt.
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `trades-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('CSV exportiert')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={download}
      disabled={busy}
      className="font-mono text-xs"
    >
      <Download className="size-3.5" />
      {busy ? 'Export…' : 'CSV-Export'}
    </Button>
  )
}
