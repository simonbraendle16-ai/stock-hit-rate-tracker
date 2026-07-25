/**
 * Hintergrund der Anmeldeseite: die Motion-Graphik aus `remotion/zone-run/`
 * als vorgerendertes 14-s-Loop. Erst wird der Plan gezeichnet (Einstieg, Stop,
 * Zielzone), dann läuft der Kurs — das erste Setup erreicht sein Ziel, das
 * zweite läuft in den Stop.
 *
 * Der Rahmen bleibt eine Server-Komponente; nur das Video selbst ist ein
 * Client-Teil, weil das `autoplay`-Attribut allein nicht zuverlässig startet
 * (siehe `auth-backdrop-video.tsx`). Die Umschaltung auf das Standbild passiert
 * weiterhin rein per `prefers-reduced-motion` in `app/globals.css`.
 * Neu rendern nach Änderungen an der Komposition:
 * `pnpm video:mp4 && pnpm video:poster`.
 */
import { AuthBackdropVideo } from '@/components/auth-backdrop-video'

export function AuthBackdrop() {
  return (
    <div className="auth-backdrop" aria-hidden="true">
      {/* Kein next/image: rein dekorativ, feste Datei, füllt den Viewport. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="auth-backdrop-still" src="/auth-bg-poster.webp" alt="" />
      <AuthBackdropVideo />
      <div className="auth-backdrop-scrim" />
    </div>
  )
}
