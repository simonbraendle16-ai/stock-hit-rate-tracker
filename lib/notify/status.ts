// Etappe 14: Zustand der Alarm-Zustellung, in einer Form, die Server und Client
// teilen. Eigene Datei, weil eine 'use server'-Datei keine Typen exportieren darf
// (Turbopack behandelt jeden Export als Server Action — siehe CLAUDE.md).

/** Warum die Zustellung gerade (nicht) funktioniert. */
export type NotifyHealth =
  /** Alles steht: Zugangsdaten da, und der Prüflauf war eben. */
  | 'ok'
  /** Zugangsdaten fehlen — es wird geprüft, aber nichts verschickt. */
  | 'kein_versand'
  /** Der letzte Prüflauf ist zu lange her: der externe Takt läuft vermutlich nicht. */
  | 'takt_fehlt'
  /** Noch nie geprüft. */
  | 'nie_gelaufen'

export interface NotifyStatus {
  health: NotifyHealth
  /** Beginn des letzten Prüflaufs, ISO — null, wenn noch keiner lief. */
  lastCheckAt: string | null
  lastTrigger: string | null
  lastError: string | null
  /** Adresse, an die gemeldet würde (aus den Einstellungen oder vom Konto). */
  recipient: string | null
  /** Eigene Adresse in den Einstellungen — leer heißt „die des Kontos gilt". */
  notifyEmail: string | null
  notifyByEmail: boolean
}

/**
 * Ab wann ein fehlender Prüflauf als Störung gilt.
 *
 * Der Takt soll alle fünf Minuten laufen; GitHub-Actions führt geplante Läufe
 * unter Last aber verzögert aus. Zwanzig Minuten sind großzügig genug, um daraus
 * keinen Fehlalarm zu machen, und eng genug, dass ein toter Takt am selben Tag
 * auffällt — nicht erst, wenn ein Einstieg verpasst wurde.
 */
export const CHECK_STALE_MS = 20 * 60 * 1000

export function healthFrom(input: {
  hasMailConfig: boolean
  lastCheckAt: Date | null
  now?: Date
}): NotifyHealth {
  if (!input.lastCheckAt) return 'nie_gelaufen'
  const now = input.now ?? new Date()
  if (now.getTime() - input.lastCheckAt.getTime() > CHECK_STALE_MS) return 'takt_fehlt'
  if (!input.hasMailConfig) return 'kein_versand'
  return 'ok'
}
