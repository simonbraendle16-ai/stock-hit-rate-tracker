'use client'
import { useEffect, useState } from 'react'
import type { SparkEntry } from '@/app/api/sparklines/route'

/** Load on page demand or explicit repair/reload; no timer, retries or focus polling. */
export function useSparklines() {
  const [sparks, setSparks] = useState<Record<number, SparkEntry>>({})
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const first = await fetch('/api/sparklines', { cache: 'no-store', signal: controller.signal })
        if (!first.ok) return
        const data = await first.json()
        if (controller.signal.aborted) return
        setSparks(data.sparks)
        const full = await fetch('/api/sparklines?closes=1', { cache: 'no-store', signal: controller.signal })
        if (!full.ok) return
        const result = await full.json()
        if (!controller.signal.aborted) setSparks(result.sparks)
      } catch { /* Keep the timestamped prior snapshot; retry is explicit. */ }
    }
    void load()
    return () => controller.abort()
  }, [reloadKey])
  return { sparks, reload: () => setReloadKey(k => k + 1) }
}

