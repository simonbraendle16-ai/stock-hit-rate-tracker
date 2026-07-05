'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createDrawing, type Drawing, type DrawingPoint } from '@/app/actions/drawings'
import { detectAll, FIB_INNER, type DetectedObject } from './detect-drawings'
import type { Candle } from '@/lib/market-data/types'
import { ImagePlus, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// AP 6 — Analyse-Import: TradingView-Screenshot → Kalibrierung → Erkennung →
// Review → native, editierbare chart_drawing-Objekte (via AP-5-Actions).
// Alles läuft im Browser, keine externen Dienste.
// ---------------------------------------------------------------------------

const MAX_WIDTH = 1000 // Screenshot wird für die Analyse auf diese Breite skaliert

// ---- Kalibrierung ----------------------------------------------------------

interface PriceRef {
  y: number
  price: number
}
interface TimeRef {
  x: number
  time: number // Unix-Sekunden
}

/** Deutsche und englische Zahlschreibweise akzeptieren. */
function parsePrice(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

/** „TT.MM.JJJJ [HH:MM]“ oder „JJJJ-MM-TT [HH:MM]“ → Unix-Sekunden (UTC). */
function parseDate(s: string): number | null {
  const t = s.trim()
  let m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (m) {
    const ts = Date.UTC(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0)
    return Math.floor(ts / 1000)
  }
  m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/)
  if (m) {
    const ts = Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0)
    return Math.floor(ts / 1000)
  }
  return null
}

type CalStep = 'p1' | 'p2' | 't1' | 't2' | 'done'

const CAL_HINTS: Record<Exclude<CalStep, 'done'>, string> = {
  p1: 'Klicke auf einen Punkt mit bekanntem PREIS (z. B. eine Achsen-Markierung).',
  p2: 'Klicke auf einen ZWEITEN Preis-Punkt — möglichst weit vom ersten entfernt.',
  t1: 'Klicke auf einen Punkt mit bekanntem DATUM (Zeitachse).',
  t2: 'Klicke auf ein ZWEITES Datum — möglichst weit vom ersten entfernt.',
}

// ---- Komponente ------------------------------------------------------------

interface ReviewItem {
  obj: DetectedObject
  include: boolean
  /** editierbare Preise: hline → [preis]; fib → [0%, 100%]; trend → [p1, p2] */
  prices: number[]
}

export function AnalysisImport({
  stockId,
  candles,
  onImported,
}: {
  stockId: number
  candles: Candle[]
  onImported: (drawings: Drawing[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'upload' | 'calibrate' | 'review'>('upload')
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [busy, setBusy] = useState(false)

  const [calStep, setCalStep] = useState<CalStep>('p1')
  const [pendingPx, setPendingPx] = useState<{ x: number; y: number } | null>(null)
  const [pendingValue, setPendingValue] = useState('')
  const [priceRefs, setPriceRefs] = useState<PriceRef[]>([])
  const [timeRefs, setTimeRefs] = useState<TimeRef[]>([])
  const [noTimeAxis, setNoTimeAxis] = useState(false)

  const [items, setItems] = useState<ReviewItem[]>([])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageDataRef = useRef<ImageData | null>(null)

  const reset = useCallback(() => {
    setStep('upload')
    setImage(null)
    setCalStep('p1')
    setPendingPx(null)
    setPendingValue('')
    setPriceRefs([])
    setTimeRefs([])
    setNoTimeAxis(false)
    setItems([])
    imageDataRef.current = null
  }, [])

  // ---- Bild laden (Datei-Dialog + Einfügen aus Zwischenablage) ------------

  const loadImage = useCallback((blob: Blob) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      setImage(img)
      setStep('calibrate')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      toast.error('Bild konnte nicht geladen werden.')
    }
    img.src = url
  }, [])

  useEffect(() => {
    if (!open || step !== 'upload') return
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      )
      const file = item?.getAsFile()
      if (file) loadImage(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open, step, loadImage])

  // ---- Screenshot + Overlays auf den Canvas zeichnen ----------------------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image) return
    const scale = Math.min(1, MAX_WIDTH / image.naturalWidth)
    canvas.width = Math.round(image.naturalWidth * scale)
    canvas.height = Math.round(image.naturalHeight * scale)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    imageDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height)

    // Kalibrier-Punkte markieren
    const drawRef = (x: number, y: number, label: string, color: string) => {
      ctx.beginPath()
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = color
      ctx.font = '11px monospace'
      ctx.fillText(label, x + 8, y - 6)
    }
    priceRefs.forEach((r, i) => drawRef(30, r.y, `P${i + 1} ${r.price}`, '#45a8ec'))
    timeRefs.forEach((r, i) => drawRef(r.x, canvas.height - 30, `T${i + 1}`, '#D4AC4E'))
    if (pendingPx) drawRef(pendingPx.x, pendingPx.y, '?', '#f1ece0')

    // Erkannte Objekte im Review überlagern
    if (step === 'review') {
      for (const it of items) {
        ctx.globalAlpha = it.include ? 1 : 0.25
        ctx.lineWidth = 2
        const o = it.obj
        if (o.kind === 'hline') {
          ctx.strokeStyle = o.color
          ctx.beginPath()
          ctx.moveTo(o.x1, o.y)
          ctx.lineTo(o.x2, o.y)
          ctx.stroke()
        } else if (o.kind === 'trendline') {
          ctx.strokeStyle = o.color
          ctx.beginPath()
          ctx.moveTo(o.x1, o.y1)
          ctx.lineTo(o.x2, o.y2)
          ctx.stroke()
        } else {
          ctx.strokeStyle = '#D4AC4E'
          for (const lvl of [0, ...FIB_INNER, 1]) {
            const y = o.y0 + (o.y100 - o.y0) * lvl
            ctx.beginPath()
            ctx.moveTo(o.x1, y)
            ctx.lineTo(o.x2, y)
            ctx.stroke()
          }
        }
        ctx.globalAlpha = 1
      }
    }
  }, [image, priceRefs, timeRefs, pendingPx, step, items])

  // ---- Kalibrier-Klicks ----------------------------------------------------

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (step !== 'calibrate' || calStep === 'done') return
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height
    setPendingPx({ x, y })
    setPendingValue('')
  }

  const confirmPending = () => {
    if (!pendingPx) return
    if (calStep === 'p1' || calStep === 'p2') {
      const price = parsePrice(pendingValue)
      if (price == null) {
        toast.error('Preis nicht lesbar — z. B. „123,45“ oder „123.45“.')
        return
      }
      if (
        calStep === 'p2' &&
        (Math.abs(priceRefs[0].y - pendingPx.y) < 10 || priceRefs[0].price === price)
      ) {
        toast.error('Die beiden Preis-Punkte müssen sich unterscheiden.')
        return
      }
      setPriceRefs((r) => [...r, { y: pendingPx.y, price }])
      setCalStep(calStep === 'p1' ? 'p2' : 't1')
    } else {
      const time = parseDate(pendingValue)
      if (time == null) {
        toast.error('Datum nicht lesbar — z. B. „05.07.2026“ oder „2026-07-05 14:30“.')
        return
      }
      if (calStep === 't2' && Math.abs(timeRefs[0].x - pendingPx.x) < 10) {
        toast.error('Die beiden Zeit-Punkte liegen zu nah beieinander.')
        return
      }
      setTimeRefs((r) => [...r, { x: pendingPx.x, time }])
      setCalStep(calStep === 't1' ? 't2' : 'done')
    }
    setPendingPx(null)
    setPendingValue('')
  }

  // ---- Erkennung + Koordinaten-Umrechnung ----------------------------------

  const priceAt = useCallback(
    (y: number): number => {
      const [a, b] = priceRefs
      return a.price + ((y - a.y) * (b.price - a.price)) / (b.y - a.y)
    },
    [priceRefs],
  )

  const timeAt = useCallback(
    (x: number): number => {
      if (noTimeAxis || timeRefs.length < 2) {
        // Ohne Zeit-Kalibrierung: x proportional auf die geladenen Kerzen legen.
        const canvas = canvasRef.current
        const w = canvas?.width || 1
        const idx = Math.round((x / w) * (candles.length - 1))
        return candles[Math.max(0, Math.min(candles.length - 1, idx))].time
      }
      const [a, b] = timeRefs
      return a.time + ((x - a.x) * (b.time - a.time)) / (b.x - a.x)
    },
    [timeRefs, noTimeAxis, candles],
  )

  /** Auf existierende Kerzenzeit snappen — sonst rendert lightweight-charts nichts. */
  const snapTime = useCallback(
    (t: number): number => {
      let best = candles[0].time
      for (const c of candles) {
        if (Math.abs(c.time - t) < Math.abs(best - t)) best = c.time
      }
      return best
    },
    [candles],
  )

  const runDetection = (skipTime: boolean) => {
    const imageData = imageDataRef.current
    if (!imageData) return
    setNoTimeAxis(skipTime)
    setBusy(true)
    // setTimeout, damit der Spinner rendert, bevor die (synchronen) Pixel-Läufe starten.
    setTimeout(() => {
      try {
        let objects = detectAll(imageData)
        if (skipTime) objects = objects.filter((o) => o.kind !== 'trendline')
        if (objects.length === 0) {
          toast.warning(
            'Keine Linien erkannt. Hinweis: Erkannt werden farbige Linien — rote/grüne (Kerzenfarben) und graue Linien werden ignoriert.',
          )
        }
        setItems(
          objects.map((obj) => ({
            obj,
            include: true,
            prices:
              obj.kind === 'hline'
                ? [priceAt(obj.y)]
                : obj.kind === 'fib'
                  ? [priceAt(obj.y0), priceAt(obj.y100)]
                  : [priceAt(obj.y1), priceAt(obj.y2)],
          })),
        )
        setStep('review')
      } catch (err) {
        console.error('analysis-import:', err)
        toast.error('Bild-Analyse fehlgeschlagen.')
      } finally {
        setBusy(false)
      }
    }, 30)
  }

  // ---- Übernahme -----------------------------------------------------------

  const applyImport = async () => {
    const chosen = items.filter((i) => i.include)
    if (chosen.length === 0) {
      toast.error('Kein Objekt ausgewählt.')
      return
    }
    setBusy(true)
    const created: Drawing[] = []
    try {
      for (const it of chosen) {
        const o = it.obj
        let type: Drawing['type']
        let points: DrawingPoint[]
        if (o.kind === 'hline') {
          type = 'hline'
          points = [{ time: candles[candles.length - 1].time, price: it.prices[0] }]
        } else if (o.kind === 'fib') {
          type = 'fib'
          let t1 = snapTime(timeAt(o.x1))
          let t2 = snapTime(timeAt(o.x2))
          if (t1 === t2) t2 = candles[candles.length - 1].time
          points = [
            { time: t1, price: it.prices[0] },
            { time: t2, price: it.prices[1] },
          ]
        } else {
          type = 'trendline'
          let t1 = snapTime(timeAt(o.x1))
          let t2 = snapTime(timeAt(o.x2))
          if (t1 === t2) {
            const idx = candles.findIndex((c) => c.time === t1)
            t2 = candles[Math.min(candles.length - 1, idx + 1)].time
          }
          points = [
            { time: t1, price: it.prices[0] },
            { time: t2, price: it.prices[1] },
          ]
        }
        const style = o.kind === 'fib' ? undefined : { color: o.color }
        created.push(await createDrawing({ stockId, type, points, style }))
      }
      onImported(created)
      toast.success(`${created.length} Objekt${created.length === 1 ? '' : 'e'} importiert.`)
      setOpen(false)
      reset()
    } catch (err) {
      // Bereits angelegte Objekte behalten (sind gespeichert) — Rest melden.
      if (created.length > 0) onImported(created)
      toast.error(
        err instanceof Error && err.message !== ''
          ? `Import unvollständig: ${err.message}`
          : 'Import unvollständig — nicht alle Objekte konnten gespeichert werden.',
      )
    } finally {
      setBusy(false)
    }
  }

  const setItemPrice = (idx: number, priceIdx: number, raw: string) => {
    const p = parsePrice(raw)
    setItems((list) =>
      list.map((it, i) =>
        i === idx && p != null
          ? { ...it, prices: it.prices.map((v, k) => (k === priceIdx ? p : v)) }
          : it,
      ),
    )
  }

  const objLabel = (o: DetectedObject) =>
    o.kind === 'hline' ? 'Level' : o.kind === 'fib' ? 'Fib-Retracement' : 'Trendlinie'

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) reset()
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="ghost" className="h-7 px-2 font-mono text-[11px]" />
        }
      >
        <ImagePlus className="size-3.5" />
        <span className="hidden sm:inline">Import</span>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Analyse aus TradingView importieren</DialogTitle>
          <DialogDescription>
            Screenshot hochladen → Achsen kalibrieren → erkannte Linien prüfen und übernehmen.
            Die Objekte landen editier- und verschiebbar im Chart.
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-6 text-center hover:border-primary/50">
            <Upload className="size-6 text-muted-foreground" />
            <span className="font-mono text-xs text-muted-foreground">
              TradingView-Screenshot wählen — oder mit Strg+V einfügen
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) loadImage(f)
              }}
            />
          </label>
        )}

        {step !== 'upload' && (
          <div>
            {step === 'calibrate' && (
              <p className="mb-2 font-mono text-xs text-primary">
                {calStep === 'done'
                  ? 'Kalibrierung vollständig.'
                  : `Schritt ${['p1', 'p2', 't1', 't2'].indexOf(calStep) + 1}/4: ${CAL_HINTS[calStep]}`}
              </p>
            )}
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="w-full max-w-full rounded border border-border"
              style={{ cursor: step === 'calibrate' && calStep !== 'done' ? 'crosshair' : 'default' }}
            />
            {pendingPx && step === 'calibrate' && calStep !== 'done' && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  autoFocus
                  value={pendingValue}
                  onChange={(e) => setPendingValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmPending()}
                  placeholder={
                    calStep === 'p1' || calStep === 'p2'
                      ? 'Preis an diesem Punkt, z. B. 123,45'
                      : 'Datum an diesem Punkt, z. B. 05.07.2026'
                  }
                  className="h-8 w-64 font-mono text-xs"
                />
                <Button size="sm" className="h-8" onClick={confirmPending}>
                  OK
                </Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setPendingPx(null)}>
                  Abbrechen
                </Button>
              </div>
            )}

            {step === 'calibrate' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {calStep === 'done' && (
                  <Button size="sm" disabled={busy} onClick={() => runDetection(false)}>
                    {busy && <Loader2 className="size-3.5 animate-spin" />}
                    Linien erkennen
                  </Button>
                )}
                {(calStep === 't1' || calStep === 't2') && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => runDetection(true)}>
                    {busy && <Loader2 className="size-3.5 animate-spin" />}
                    Ohne Zeitachse fortfahren (nur Level/Fib)
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={reset}>
                  Anderes Bild
                </Button>
              </div>
            )}

            {step === 'review' && (
              <div className="mt-3">
                {items.length === 0 ? (
                  <p className="font-mono text-xs text-muted-foreground">
                    Nichts erkannt. Tipp: farbige, durchgehende Linien werden am besten erkannt —
                    rote/grüne und graue Linien werden bewusst ignoriert (Kerzen/Grid).
                  </p>
                ) : (
                  <div className="max-h-56 divide-y divide-border overflow-y-auto">
                    {items.map((it, idx) => (
                      <div key={idx} className="flex flex-wrap items-center gap-2 py-2 font-mono text-xs">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={it.include}
                            onChange={(e) =>
                              setItems((l) =>
                                l.map((x, i) => (i === idx ? { ...x, include: e.target.checked } : x)),
                              )
                            }
                          />
                          <span
                            className="inline-block size-2.5 rounded-full"
                            style={{
                              background: it.obj.kind === 'fib' ? '#D4AC4E' : it.obj.color,
                            }}
                          />
                          <span className="w-28">{objLabel(it.obj)}</span>
                        </label>
                        {it.prices.map((p, pi) => (
                          <Input
                            key={pi}
                            defaultValue={p.toLocaleString('de-DE', {
                              maximumFractionDigits: 6,
                              useGrouping: false,
                            })}
                            onBlur={(e) => setItemPrice(idx, pi, e.target.value)}
                            className="h-7 w-28 font-mono text-xs"
                            title={
                              it.obj.kind === 'fib'
                                ? pi === 0
                                  ? 'Preis 0 %'
                                  : 'Preis 100 %'
                                : it.obj.kind === 'trendline'
                                  ? pi === 0
                                    ? 'Preis Startpunkt'
                                    : 'Preis Endpunkt'
                                  : 'Preis des Levels'
                            }
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy || items.every((i) => !i.include)} onClick={applyImport}>
                    {busy && <Loader2 className="size-3.5 animate-spin" />}
                    {items.filter((i) => i.include).length} Objekt
                    {items.filter((i) => i.include).length === 1 ? '' : 'e'} übernehmen
                  </Button>
                  <Button size="sm" variant="ghost" onClick={reset}>
                    Von vorn
                  </Button>
                </div>
                <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                  Preise sind exakt eintippbar (Kalibrierung ist nie pixelperfekt). Nach dem Import
                  lassen sich alle Objekte im Chart verschieben, editieren und löschen.
                </p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
