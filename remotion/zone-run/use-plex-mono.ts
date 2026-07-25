import { useEffect, useState } from 'react'
import { continueRender, delayRender } from 'remotion'

const CSS_URL =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap'

/** Schriftstapel für alle Labels im Video — IBM Plex wie in der App. */
export const MONO = "'IBM Plex Mono', ui-monospace, 'SFMono-Regular', monospace"

/**
 * Lädt IBM Plex Mono vor dem Render und hält den Frame so lange zurück.
 * Der Render darf daran niemals hängen bleiben: schlägt der Abruf fehl oder
 * dauert er zu lange, wird nach 4 s mit dem System-Monospace weitergerendert.
 */
export function usePlexMono(): void {
  const [handle] = useState(() => delayRender('IBM Plex Mono laden'))

  useEffect(() => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      continueRender(handle)
    }

    const timeout = setTimeout(finish, 4000)

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = CSS_URL
    link.onload = () => {
      document.fonts
        .load("500 21px 'IBM Plex Mono'")
        .then(finish)
        .catch(finish)
    }
    link.onerror = finish
    document.head.appendChild(link)

    return () => {
      clearTimeout(timeout)
      finish()
    }
  }, [handle])
}
