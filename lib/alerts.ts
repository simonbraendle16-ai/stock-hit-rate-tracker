// Reine Alert-Logik für Etappe 3 (Kurs-Alerts) — ohne DB, ohne React, ohne
// 'use server'. Dadurch direkt testbar (`lib/alerts.test.ts`) und gemeinsame
// Quelle für die Server Action (Auslöse-Abgleich) und die UI (Beschriftung,
// Richtungswahl beim Anlegen) — genau wie `lib/emotions.ts` es vormacht.
//
// Ein Alert beschreibt EIN Preislevel und die Richtung, in der es erreicht
// werden muss. Er löst genau einmal aus (die Server Action setzt danach
// `triggeredAt`); hier steckt nur die Entscheidung, OB er ausgelöst ist.

import type { Candle } from '@/lib/market-data/types'

// ---------------------------------------------------------------------------
// Typen & Kataloge
// ---------------------------------------------------------------------------

/** 'above' = Kurs erreicht das Level von unten; 'below' = von oben. */
export type AlertDirection = 'above' | 'below'

/** Herkunft eines Alerts. Aus dem Plan abgeleitet oder frei gesetzt. */
export type AlertKind = 'einstieg' | 'stop' | 'ziel' | 'manuell'

export const ALERT_DIRECTIONS: readonly AlertDirection[] = ['above', 'below']
export const ALERT_KINDS: readonly AlertKind[] = ['einstieg', 'stop', 'ziel', 'manuell']

export function isAlertDirection(v: unknown): v is AlertDirection {
  return v === 'above' || v === 'below'
}

export function isAlertKind(v: unknown): v is AlertKind {
  return typeof v === 'string' && (ALERT_KINDS as readonly string[]).includes(v)
}

const KIND_LABEL: Record<AlertKind, string> = {
  einstieg: 'Einstieg',
  stop: 'Stop',
  ziel: 'Ziel',
  manuell: 'Alert',
}

/** Anzeigename der Alert-Herkunft. */
export function alertKindLabel(kind: string): string {
  return isAlertKind(kind) ? KIND_LABEL[kind] : 'Alert'
}

/** Kurzbeschreibung, z. B. „fällt auf/unter" — für Karten und Toasts. */
export function directionVerb(direction: AlertDirection): string {
  return direction === 'above' ? 'steigt auf/über' : 'fällt auf/unter'
}

// ---------------------------------------------------------------------------
// Richtungswahl beim Anlegen
// ---------------------------------------------------------------------------

/**
 * Die Kreuzungsrichtung eines Levels relativ zu einem Bezugskurs.
 *
 * Ein Level OBERHALB des aktuellen Kurses wird erreicht, indem der Kurs steigt
 * ('above'); ein Level darunter, indem er fällt ('below'). Liegt das Level exakt
 * auf dem Bezugskurs, ist die Richtung mehrdeutig → `null` (der Aufrufer lehnt
 * dann ab oder nutzt einen Ersatz-Bezug).
 */
export function directionForLevel(level: number, reference: number): AlertDirection | null {
  if (!Number.isFinite(level) || !Number.isFinite(reference)) return null
  if (level > reference) return 'above'
  if (level < reference) return 'below'
  return null
}

// ---------------------------------------------------------------------------
// Serialisierbare Formen für die Grenze Server ↔ Client
// ---------------------------------------------------------------------------
//
// Die Typen leben hier (rein), nicht in `app/actions/alerts.ts`: eine
// 'use server'-Datei darf ausschließlich async Funktionen exportieren — genau
// wie `SUPPORTED_CURRENCIES` in `lib/format.ts` statt in einer Action liegt.

/** Eingabe zum Anlegen eines Alerts. Richtung optional — sonst aus dem Kurs abgeleitet. */
export type CreateAlertInput = {
  ticker: string
  market: string
  price: number
  /** Weggelassen → aus dem aktuellen Kurs bestimmt (Level über Kurs = 'above'). */
  direction?: AlertDirection
  note?: string | null
  stockId?: number | null
  tradeId?: number | null
  kind?: AlertKind
}

/** Ein Alert, wie ihn die UI sieht — Datumswerte als ISO-Strings. */
export type AlertView = {
  id: number
  ticker: string
  market: string
  price: number
  direction: AlertDirection
  kind: AlertKind
  note: string | null
  active: boolean
  triggeredAt: string | null
  createdAt: string
  tradeId: number | null
  stockId: number | null
}

// ---------------------------------------------------------------------------
// Auslöse-Abgleich
// ---------------------------------------------------------------------------

/**
 * Zustands-Prüfung: liegt `price` bereits auf der Auslöse-Seite des Levels?
 *
 * Bewusst inklusiv (>=/<=): genau auf dem Level gilt als erreicht. Wird beim
 * Anlegen genutzt, um einen bereits erfüllten Alert abzulehnen (kein Sofort-
 * auslösen), und als Rückfall, wenn nur ein einzelner Kurs vorliegt.
 */
export function isLevelReached(direction: AlertDirection, level: number, price: number): boolean {
  if (!Number.isFinite(level) || !Number.isFinite(price)) return false
  return direction === 'above' ? price >= level : price <= level
}

/**
 * Hat eine Kerze das Level erreicht? Nutzt High/Low statt nur des Schlusskurses,
 * damit ein kurzer Ausschlag INNERHALB der Kerze nicht übersehen wird — genau
 * der Fall, in dem ein Stop oder ein Ziel „berührt" wird.
 */
export function candleReachesLevel(
  direction: AlertDirection,
  level: number,
  candle: Pick<Candle, 'high' | 'low'>,
): boolean {
  if (!Number.isFinite(level)) return false
  return direction === 'above' ? candle.high >= level : candle.low <= level
}

/**
 * Prüft eine Reihe Kerzen ab einem Zeitpunkt: wurde das Level seit `sinceSec`
 * (Unix-Sekunden) in einer der Kerzen erreicht?
 *
 * Nur Kerzen ab dem Anlege-Zeitpunkt zählen — ein Level, das der Kurs schon
 * VOR dem Setzen des Alerts durchlaufen hat, löst nicht rückwirkend aus. Kerzen
 * ohne verwertbares High/Low werden übersprungen.
 */
export function alertTriggeredByCandles(
  direction: AlertDirection,
  level: number,
  candles: readonly Candle[],
  sinceSec = 0,
): boolean {
  for (const c of candles) {
    if (c.time < sinceSec) continue
    if (!Number.isFinite(c.high) || !Number.isFinite(c.low)) continue
    if (candleReachesLevel(direction, level, c)) return true
  }
  return false
}
