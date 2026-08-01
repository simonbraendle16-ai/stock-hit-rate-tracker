// Etappe 14: Betreff und Text der Alarm-Mail. Reine Funktionen, kein Netz, keine
// Datenbank — damit der Inhalt getestet werden kann, ohne eine Mail zu schicken.
//
// Ton wie überall in dieser App: nüchtern, keine Aufforderung zum Handeln. Die
// Mail meldet einen ZUSTAND („der Kurs hat dein Level erreicht") und führt zu der
// Ansicht, in der die Entscheidung fällt. Sie sagt nie „kaufen" oder „jetzt
// zuschlagen" — das wäre genau die Prognose-/Drucksprache, gegen die diese App
// gebaut ist.
//
// Ehrlichkeitsgebot: Der Kurs ist NICHT live (letzte Kerze bzw. Snapshot, bis zu
// einige Minuten alt). Deshalb steht in jeder Mail, woher der Wert stammt.

import { alertKindLabel, type AlertDirection, type AlertKind } from '@/lib/alerts'

/** Eine ausgelöste Meldung, so weit sie für den Text gebraucht wird. */
export interface AlertMailItem {
  ticker: string
  kind: AlertKind
  direction: AlertDirection
  /** Das gesetzte Level. */
  level: number
  /** Der Kurs, mit dem ausgelöst wurde — null, wenn er gerade nicht vorlag. */
  price: number | null
  /** Zeitstempel des Kurses (Unix-Sekunden), Grundlage für „Kurs von 14:32". */
  quotedAtSec: number | null
  /** Zugehöriger Trade, falls die Meldung aus einem Plan stammt. */
  tradeId: number | null
  /** Plan-Eckwerte, nur für Meldungen mit Trade. */
  entry: number | null
  stop: number | null
  target: number | null
}

export interface AlertMailInput {
  items: readonly AlertMailItem[]
  /** Basis-URL der App, ohne Schrägstrich am Ende. */
  baseUrl: string
  /** Für „Kurs von 14:32" — überschreibbar, damit der Test nicht von der Uhr abhängt. */
  timeZone?: string
}

export interface AlertMail {
  subject: string
  text: string
}

function formatNumber(v: number): string {
  // Deutsche Schreibweise mit bis zu zwei Nachkommastellen; bei sehr kleinen
  // Kursen (Krypto-Altcoins) mehr, sonst stünde dort „0,00".
  const digits = Math.abs(v) >= 1 ? 2 : 6
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(v)
}

function formatTime(sec: number, timeZone?: string): string {
  return new Intl.DateTimeFormat('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(sec * 1000))
}

/** „SOL hat 148,20 erreicht" — eine Zeile, die auch als Vorschau taugt. */
function headline(item: AlertMailItem): string {
  return `${item.ticker} hat ${formatNumber(item.level)} erreicht`
}

/**
 * Der Link führt bei Plan-Meldungen in die Einstiegs-Ansicht (Abschnitt 2), sonst
 * auf das Cockpit. Ein Einstieg ist der einzige Fall, in dem sofort eine
 * Entscheidung ansteht — Stop und Ziel sind Ereignisse an einem laufenden Trade.
 */
export function alertLink(item: AlertMailItem, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  if (item.tradeId == null) return `${base}/`
  if (item.kind === 'einstieg') return `${base}/trades/${item.tradeId}/einstieg`
  return `${base}/trades/${item.tradeId}`
}

/**
 * Betreff und Text für die Meldungen EINES Nutzers aus EINEM Lauf.
 *
 * Mehrere gleichzeitig erreichte Level kommen bewusst in einer Mail: Drei
 * einzelne Nachrichten im selben Moment erzeugen Hektik, und Hektik ist genau
 * das, was hier nicht entstehen soll.
 */
export function buildAlertMail(input: AlertMailInput): AlertMail | null {
  const items = input.items
  if (items.length === 0) return null

  const first = items[0]
  const subject =
    items.length === 1
      ? `${headline(first)} — ${alertKindLabel(first.kind)}`
      : `${items.length} Kursmarken erreicht — ${items.map((i) => i.ticker).join(', ')}`

  const blocks = items.map((item) => {
    const lines: string[] = []
    lines.push(`${headline(item)} (${alertKindLabel(item.kind)})`)

    if (item.price != null) {
      const stamp = item.quotedAtSec != null ? ` (Kurs von ${formatTime(item.quotedAtSec, input.timeZone)})` : ''
      lines.push(`Kurs: ${formatNumber(item.price)}${stamp}`)
    } else {
      lines.push('Kurs: gerade nicht abrufbar')
    }

    const plan: string[] = []
    if (item.entry != null) plan.push(`Einstieg ${formatNumber(item.entry)}`)
    if (item.stop != null) plan.push(`Stop ${formatNumber(item.stop)}`)
    if (item.target != null) plan.push(`Ziel ${formatNumber(item.target)}`)
    if (plan.length) lines.push(`Dein Plan: ${plan.join(' · ')}`)

    lines.push(alertLink(item, input.baseUrl))
    return lines.join('\n')
  })

  const text = [
    blocks.join('\n\n'),
    'Der Kurs stammt aus der letzten geladenen Kerze und ist nicht live.\nHandle deinen Plan, nicht deine Emotion.',
  ].join('\n\n')

  return { subject, text }
}

/**
 * Empfängeradresse: die eigens hinterlegte, sonst die des Kontos.
 *
 * Kein Backfill der Konto-Adresse in die Einstellungen — eine Kopie liefe
 * auseinander, sobald das Konto die Adresse wechselt.
 */
export function resolveRecipient(
  settingsEmail: string | null | undefined,
  accountEmail: string | null | undefined,
): string | null {
  const own = settingsEmail?.trim()
  if (own) return own
  const account = accountEmail?.trim()
  return account ? account : null
}
