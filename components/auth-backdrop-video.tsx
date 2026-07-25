'use client'

import { useEffect, useRef } from 'react'

/**
 * Das Hintergrund-Video der Anmeldeseite.
 *
 * Warum überhaupt Client-JS: Das `autoplay`-Attribut allein genügt nicht. Lädt
 * die Seite, während das Tab im Hintergrund liegt, unterdrückt Chrome den Start
 * — und holt ihn nicht verlässlich nach, sobald das Tab nach vorn kommt. Die
 * Seite zeigt dann dauerhaft das Poster-Standbild. Deshalb stossen wir die
 * Wiedergabe selbst an und fassen bei jedem Sichtbarwerden nach.
 *
 * Der Aufwand bleibt klein: kein Player, keine Bibliothek, ein Effekt. Das
 * Markup wird weiterhin serverseitig gerendert, es gibt also kein Aufblitzen.
 *
 * Bei `prefers-reduced-motion: reduce` wird bewusst nichts gestartet — dort
 * blendet `app/globals.css` das Video aus und zeigt das Standbild.
 *
 * Nur H.264/MP4, kein WebM: Remotions VP9-Ausgabe lässt sich hier nicht
 * dekodieren (Chromium bricht mit `PIPELINE_ERROR_DECODE` ab, das Bild friert
 * ein). Ein *Decode*-Fehler wechselt zudem nicht auf ein weiteres `<source>` —
 * ein WebM an erster Stelle würde die Wiedergabe also schlicht blockieren.
 * H.264 spielt jeder aktuelle Browser, und die Datei ist mit ~370 kB sogar
 * kleiner als das VP9-WebM war.
 */
export function AuthBackdropVideo() {
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // `play()` lehnt ab, solange das Tab verborgen ist; das ist kein Fehler,
    // sondern der Normalfall, den `visibilitychange` gleich darauf nachholt.
    const start = () => {
      if (document.visibilityState !== 'visible') return
      if (!video.paused) return
      void video.play().catch(() => {
        /* Autoplay verweigert: das Poster bleibt stehen, die Seite ist intakt. */
      })
    }

    start()
    document.addEventListener('visibilitychange', start)
    video.addEventListener('canplay', start)

    return () => {
      document.removeEventListener('visibilitychange', start)
      video.removeEventListener('canplay', start)
    }
  }, [])

  return (
    <video
      ref={ref}
      className="auth-backdrop-video"
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      poster="/auth-bg-poster.webp"
    >
      <source src="/auth-bg.mp4" type="video/mp4" />
    </video>
  )
}
