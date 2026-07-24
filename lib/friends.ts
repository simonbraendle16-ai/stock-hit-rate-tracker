// Freunde (Etappe 2) — die reine, testbare Logik.
//
// Wie `lib/emotions.ts` und `lib/alerts.ts`: keine DB, kein Auth, kein React,
// kein 'use server'. Die Server Action (`app/actions/friends.ts`) lädt nur die
// Zeilen und ruft in diese Funktionen hinein — es gibt keine zweite Rechen-
// oder Sichtbarkeitslogik daneben.
//
// Kern-Leitplanke dieser Etappe (Douglas-Filter): Ein Freund sieht IMMER nur
//   1. abgeschlossene Trades (nie offene/geplante → kein Copy-Trading) und
//   2. deren Ergebnis in R-Vielfachen (nie einen Betrag → keine Kontogröße).
// Genau EINE feste Stufe, keine Auswahl. Beide Regeln stecken hier in reinem
// Code, damit sie an einer Stelle geprüft werden und nicht umgangen werden
// können.

import { tradePnl, tradeRisk, hasPnl, type TradeRow, type DisciplineStats } from './trade-stats'
import { computeRiskReward } from './trade-math'

// ---------------------------------------------------------------------------
// Einladungscode
// ---------------------------------------------------------------------------

// Ohne 0/O/1/I/L — die beim Abtippen/Vorlesen am leichtesten verwechselt werden.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const INVITE_CODE_LENGTH = 8

/** Gültigkeitsdauer eines Codes: eine Woche reicht, um ihn weiterzugeben. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Ein zufälliger Einladungscode aus dem eindeutigen Alphabet. `rng` ist
 * injizierbar, damit der Test den Code deterministisch machen kann; im Betrieb
 * bleibt es `Math.random` (der Code ist kein Geheimnis mit Sicherheitsauftrag —
 * er läuft ab, ist einmal einlösbar und an einen erstellenden Nutzer gebunden).
 */
export function generateInviteCode(rng: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)]
  }
  return out
}

/** Eingabe des Empfängers robust machen: Leerraum/Bindestriche weg, groß. */
export function normalizeInviteCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Ablaufzeitpunkt eines jetzt erzeugten Codes. */
export function inviteExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_MS)
}

/** Abgelaufen, sobald der Ablaufzeitpunkt erreicht oder überschritten ist. */
export function isInviteExpired(expiresAt: Date | string, now: Date = new Date()): boolean {
  return new Date(expiresAt).getTime() <= now.getTime()
}

// ---------------------------------------------------------------------------
// Sichtbare Sicht auf einen Freund — betragsfrei, nur R
// ---------------------------------------------------------------------------

/**
 * Ein geteilter Trade eines Freundes, reduziert auf das, was geteilt werden
 * darf. Bewusst KEIN Betrag, keine Stückzahl, kein Einsatz, keine Kurse — nur
 * größenunabhängige Verhältniszahlen:
 *  - `r` (realisiertes R-Vielfaches, nur bei abgeschlossenen Trades) macht einen
 *    500-€- und einen 50.000-€-Account vergleichbar, ohne die Kontogröße zu
 *    verraten.
 *  - `plannedRR` (geplantes Chance-Risiko-Verhältnis) zeigt bei geplanten wie
 *    abgeschlossenen Trades die Absicht, ebenfalls ohne einen Betrag.
 * `status` unterscheidet die Absicht (`geplant`) vom Ergebnis (`abgeschlossen`).
 */
export type FriendTrade = {
  id: number
  ticker: string
  market: string
  direction: 'long' | 'short'
  status: 'geplant' | 'abgeschlossen'
  result: 'gewinn' | 'verlust' | 'breakeven' | null
  r: number | null // realisiertes R — null bei geplanten Trades
  plannedRR: number | null // geplantes Chance-Risiko-Verhältnis
  followedPlan: boolean
  createdAt: string
  closedAt: string | null
}

/**
 * Fremde Trade-Zeilen → teilbare Sicht. Sichtbar sind:
 *  - `status === 'geplant'` — die Absicht (bewusst geteilt, damit ein Freund
 *    sieht, was man vorhat: Accountability schon vor dem Einstieg), und
 *  - `status === 'abgeschlossen'` mit berechenbarem P&L (`hasPnl`) — das
 *    Ergebnis in R.
 * NICHT sichtbar bleiben laufende (`aktiv`), abgebrochene und Nicht-Trades:
 * Ein offener Trade würde kopierbar, ohne dass ein Ergebnis daraus lernbar ist.
 * Sortiert: geplante zuerst (aktuelle Absichten), dann abgeschlossene; je Gruppe
 * das Jüngste oben. Diese Funktion ist die einzige Stelle, an der aus einem
 * `TradeRow` etwas nach außen Sichtbares wird.
 */
export function projectFriendTrades(rows: TradeRow[]): FriendTrade[] {
  return rows
    .filter((t) => (t.status === 'abgeschlossen' ? hasPnl(t) : t.status === 'geplant'))
    .map((t): FriendTrade => {
      const isClosed = t.status === 'abgeschlossen'
      const pnl = tradePnl(t)
      const risk = tradeRisk(t)
      return {
        id: t.id,
        ticker: t.ticker,
        market: t.market,
        direction: t.direction === 'short' ? 'short' : 'long',
        status: isClosed ? 'abgeschlossen' : 'geplant',
        result:
          isClosed && (t.result === 'gewinn' || t.result === 'verlust' || t.result === 'breakeven')
            ? t.result
            : null,
        // tradeRisk() gibt nie 0 zurück (Fallback size×10), der Guard ist die
        // zweite Linie, damit hier niemals durch 0 geteilt wird.
        r: isClosed && pnl !== null && risk > 0 ? pnl / risk : null,
        plannedRR: computeRiskReward(t.entryPrice, t.stopLoss, t.takeProfit),
        followedPlan: t.followedPlan === true,
        createdAt: new Date(t.createdAt).toISOString(),
        closedAt: t.closedAt ? new Date(t.closedAt).toISOString() : null,
      }
    })
    .sort((a, b) => {
      // geplante Absichten zuerst, dann Ergebnisse
      if (a.status !== b.status) return a.status === 'geplant' ? -1 : 1
      // je Gruppe das Jüngste oben: abgeschlossene nach Abschluss, geplante nach Anlage
      const at = a.status === 'abgeschlossen' ? (a.closedAt ?? a.createdAt) : a.createdAt
      const bt = b.status === 'abgeschlossen' ? (b.closedAt ?? b.createdAt) : b.createdAt
      return bt.localeCompare(at)
    })
}

/**
 * Die teilbaren Disziplin-Kennzahlen eines Freundes. Alle größenunabhängig:
 * Prozente, ein Zähler und ein R-Erwartungswert. KEINE Geldfelder —
 * `totalPnL`, `currentBalance`, `startCapital`, `returnPct` bleiben bewusst
 * außen vor, weil sie die Kontogröße verraten würden.
 */
export type FriendSummary = {
  completed: number
  disciplineScore: number
  winRate: number
  expectancy: number // Ø R-Vielfaches
  streak: number
  ruleViolations: number
}

/**
 * Aus den vollen Disziplin-Kennzahlen (bereits über die reine Funktion
 * `computeDisciplineStats` gerechnet — für fremde Daten unverändert gültig) nur
 * die betragsfreien Felder herauslösen. Das ist der Whitelist-Filter, der
 * verhindert, dass je ein Geldwert an einen Freund gelangt.
 */
export function toFriendSummary(d: DisciplineStats): FriendSummary {
  return {
    completed: d.completed,
    disciplineScore: d.disciplineScore,
    winRate: d.winRate,
    expectancy: d.expectancy,
    streak: d.streak,
    ruleViolations: d.ruleViolations,
  }
}

/** Das vollständige, teilbare Journal eines Freundes (Rückgabe der Action). */
export type FriendJournal = {
  friendId: string
  name: string
  summary: FriendSummary
  trades: FriendTrade[]
}

/** Eintrag der Freundesliste: Zusammenfassung plus Identität. */
export type FriendListEntry = {
  friendId: string
  name: string
  summary: FriendSummary
}
