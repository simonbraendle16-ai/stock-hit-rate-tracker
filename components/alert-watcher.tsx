'use client'

// Hintergrund-Abgleich der Kurs-Alerts (Etappe 3). Rendert nichts — läuft nur,
// solange das Cockpit offen ist, ruft in Intervallen `checkAlerts()` auf und
// meldet neu ausgelöste Alerts per Browser-Notification und Toast.
//
// Bewusst KEIN Push-Dienst (kein Service Worker, kein VAPID): kostenlos und
// ohne Server-Infrastruktur. Preis dafür ist, dass der Tab offen sein muss —
// verpasste Alerts gehen nicht verloren, sie stehen weiter im Cockpit-Panel.

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { checkAlerts } from '@/app/actions/alerts'
import { alertKindLabel, directionVerb, type AlertView } from '@/lib/alerts'
import { toast } from 'sonner'

/** Abgleich alle 5 Minuten — passt zum 15-Min-Kurscache, ohne ihn oft zu verfehlen. */
const INTERVAL_MS = 5 * 60 * 1000

function notify(a: AlertView) {
  const title = `${alertKindLabel(a.kind)}: ${a.ticker}`
  const body = `${a.ticker} ${directionVerb(a.direction)} ${a.price}${a.note ? ` — ${a.note}` : ''}`
  toast.warning(`🔔 ${body}`)
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, tag: `alert-${a.id}` })
    } catch {
      // Manche Browser werfen ohne Nutzergeste — der Toast bleibt als Rückfall.
    }
  }
}

export function AlertWatcher() {
  const router = useRouter()
  // Verhindert doppelte Meldungen, falls ein Lauf sich mit dem nächsten überschneidet.
  const running = useRef(false)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (running.current) return
      running.current = true
      try {
        const triggered = await checkAlerts()
        if (cancelled || triggered.length === 0) return
        for (const a of triggered) notify(a)
        router.refresh() // Panel aktualisieren (ausgelöste rücken nach oben)
      } catch {
        // Netz-/Kursfehler sind vorübergehend — der nächste Lauf versucht es erneut.
      } finally {
        running.current = false
      }
    }

    run()
    const id = setInterval(run, INTERVAL_MS)
    // Beim Zurückkehren auf den Tab sofort prüfen, nicht bis zum Intervall warten.
    const onVisible = () => {
      if (document.visibilityState === 'visible') run()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [router])

  return null
}
