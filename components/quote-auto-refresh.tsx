'use client'

// Hält die Kurse einer offenen Seite frisch.
//
// Warum es das braucht: Die Kurse stehen in `quote_snapshot` und werden vom
// Cron-Lauf gefüllt. Auf dem Vercel-Hobby-Plan darf der aber nur EINMAL AM TAG
// laufen — ohne Zutun stünde auf Analyse, Auswertung und Instrument-Detail also
// stundenalte Ware. Die Watchlist löst das über ihren eigenen Takt auf
// `/api/sparklines`; für die serverseitig gerenderten Seiten übernimmt es diese
// Komponente.
//
// Sie rendert nichts. Sie fragt nur nach — und die Serveraktion entscheidet
// anhand des Alters, ob wirklich beim Anbieter geholt wird. Ein Takt von einer
// Minute heißt deshalb nicht „jede Minute eine Anbieteranfrage", sondern
// „höchstens so alt darf das Angezeigte werden".

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { refreshQuotes } from '@/app/actions/symbols'

const POLL_MS = 60_000

export function QuoteAutoRefresh() {
  const router = useRouter()
  // Verhindert überlappende Läufe, wenn eine Anfrage länger dauert als der Takt.
  const busy = useRef(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const tick = async ({ force = false } = {}) => {
      if (cancelled || busy.current) return
      // Im Hintergrundtab nicht WEITER nachfragen — niemand sieht die Zahl. Der
      // erste Lauf greift trotzdem, sonst bliebe eine im Hintergrund geöffnete
      // Seite auf ihrem alten Stand stehen, bis man sie anschaut.
      if (!force && document.visibilityState === 'hidden') return
      busy.current = true
      try {
        // Nur wenn wirklich geholt wurde, lohnt das Neuladen der Serverdaten.
        if (await refreshQuotes()) router.refresh()
      } catch {
        // Ein Anbieter- oder Netzfehler darf die Seite nicht stören: Es bleibt
        // der letzte bekannte Kurs mit seinem Zeitstempel stehen.
      } finally {
        busy.current = false
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick()
    }

    void tick({ force: true })
    timer = setInterval(() => void tick(), POLL_MS)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [router])

  return null
}
