'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Zählt eine Kennzahl beim Erscheinen hoch.
 *
 * Serverseitig und im ersten Client-Render steht sofort der Endwert — dadurch
 * gibt es kein Layout-Shift und kein Aufblitzen, und ohne JavaScript stimmt
 * die Zahl trotzdem. Erst danach startet der Lauf von 0. Bei
 * `prefers-reduced-motion: reduce` bleibt es beim Endwert.
 */
export function CountUp({
  value,
  durationMs = 700,
  format,
  decimals = 0,
  prefix = '',
  suffix = '',
  signed = false,
}: {
  value: number
  durationMs?: number
  /**
   * Nur aus Client-Komponenten heraus verwendbar — Funktionen lassen sich nicht
   * über die Server/Client-Grenze reichen. Aus Server-Komponenten stattdessen
   * `decimals` / `prefix` / `suffix` / `signed` benutzen, die sind serialisierbar.
   */
  format?: (value: number) => string
  decimals?: number
  prefix?: string
  suffix?: string
  /** Setzt bei positiven Werten ein '+' davor (z. B. Erwartungswert, Bilanz). */
  signed?: boolean
}) {
  const [display, setDisplay] = useState(value)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || durationMs <= 0) {
      setDisplay(value)
      return
    }

    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      // Gleiche Kurve wie --ease-out in globals.css: schnell an, weich aus.
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(value * eased)
      if (t < 1) frameRef.current = requestAnimationFrame(tick)
    }

    setDisplay(0)
    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [value, durationMs])

  if (format) return <>{format(display)}</>

  const sign = signed && display >= 0 ? '+' : ''
  return <>{`${sign}${prefix}${display.toFixed(decimals)}${suffix}`}</>
}
