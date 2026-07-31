// Depots (Etappe 12) — die gemeinsame Quelle dafür, WELCHE Trades eine
// Auswertung überhaupt sieht.
//
// Der Anlass war ein stiller Rechenfehler: `tradedWithMoney` stand seit langem am
// Trade, gefiltert wurde darauf aber nur bei den reinen Geldzahlen. Trefferquote,
// Erwartungswert, Disziplin-Score, Monte-Carlo, Setups, Zeit-Heatmap, MAE/MFE und
// sogar die mit Freunden geteilten Kennzahlen mischten Übung und Ernst. Im
// Bestand war das kein Randfall: Von 20 Trades war genau einer abgeschlossen —
// ein Demo-Trade. Die gesamte Auswertung ruhte damit auf Übungsgeld.
//
// Der Fehler war nicht, dass irgendwo ein Filter fehlte. Der Fehler war, dass es
// KEINEN gemeinsamen Ort gab, an dem „welche Trades gelten jetzt" entschieden
// wird — sechzehn Abfragen entschieden es sechzehnmal, und fünfzehn davon
// entschieden es falsch. Deshalb steht die Antwort ab hier an genau einer Stelle.
//
// Dieselbe Begründung wie bei `getInstrumentCards` (Etappe 10): vier eigene
// Abfragen wären vier Gelegenheiten, dieselbe Kennzahl verschieden zu rechnen.
//
// Diese Datei ist REIN — kein Datenbankzugriff, keine Serveraktion. Sie
// entscheidet nur über Formate und Regeln und ist deshalb testbar. Das Laden
// liegt in `app/actions/portfolios.ts`.

import type { portfolio } from '@/lib/db/schema'

export const PORTFOLIO_KINDS = ['echtgeld', 'demo'] as const

export type PortfolioKind = (typeof PORTFOLIO_KINDS)[number]

/** Eine Depot-Zeile, wie sie aus der Datenbank kommt. */
export type PortfolioRow = typeof portfolio.$inferSelect

/**
 * Das Depot, wie es ein Formular braucht — nur die Felder, die die Eingabe
 * tatsächlich steuern.
 *
 * Bewusst ein eigener, schmaler Typ statt `PortfolioRow`: Ein Formular soll
 * `archivedAt` oder `createdAt` gar nicht sehen können, und Startkapital und
 * Gebühren gehören hierher, weil sie am Depot hängen (Risiko-Guard und
 * Gebühren-Vorbelegung wechseln mit der Auswahl).
 */
export type PortfolioOption = {
  id: number
  name: string
  kind: PortfolioKind
  startCapital: number
  defaultFeeEntry: number
  defaultFeeExit: number
}

/** Zeilen aus der Datenbank in die Formularsicht bringen — an einer Stelle. */
export function toPortfolioOptions(rows: PortfolioRow[]): PortfolioOption[] {
  return rows
    // In ein archiviertes Depot wird nicht gebucht (siehe `checkMove`), deshalb
    // erscheint es in der Erfassung gar nicht erst.
    .filter((p) => p.archivedAt == null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      kind: normalizePortfolioKind(p.kind),
      startCapital: p.startCapital,
      defaultFeeEntry: p.defaultFeeEntry,
      defaultFeeExit: p.defaultFeeExit,
    }))
}

/** Das Nötigste, was die Scope-Auflösung von einem Depot wissen muss. */
export type PortfolioLike = {
  id: number
  kind: string
  archivedAt?: Date | string | null
}

/**
 * Die aktive Auswahl. Zwei Formen, mit Absicht keine dritte:
 *
 * - `alleEchtgeld` — Aggregat über alle nicht archivierten Echtgeld-Depots.
 *   Das ist die einzige depotübergreifende Sicht, und Demo ist darin NIE
 *   enthalten. Ein Aggregat „alles inklusive Übung" gibt es bewusst nicht: Es
 *   wäre exakt die Zahl, die diese Etappe abgeschafft hat.
 * - `depot` — genau ein Depot, auch ein archiviertes (die Historie bleibt
 *   lesbar).
 */
export type Scope =
  | { type: 'alleEchtgeld' }
  | { type: 'depot'; portfolioId: number }

/** Die Auswahl, die ein Konto ohne eigene Entscheidung hat. */
export const DEFAULT_SCOPE: Scope = { type: 'alleEchtgeld' }

/** Der in `user_settings.activeScope` gespeicherte Text für das Aggregat. */
const AGGREGAT = 'echtgeld'
const DEPOT_PREFIX = 'depot:'

export function normalizePortfolioKind(v: string | null | undefined): PortfolioKind {
  return (PORTFOLIO_KINDS as readonly string[]).includes(v ?? '')
    ? (v as PortfolioKind)
    : 'echtgeld'
}

export const PORTFOLIO_KIND_LABEL: Record<PortfolioKind, string> = {
  echtgeld: 'Echtgeld',
  demo: 'Demo',
}

/** Kurzform für Abzeichen und enge Spalten. */
export const PORTFOLIO_KIND_BADGE: Record<PortfolioKind, string> = {
  echtgeld: 'ECHTGELD',
  demo: 'PAPIERGELD',
}

export const PORTFOLIO_KIND_HINT: Record<PortfolioKind, string> = {
  echtgeld:
    'Echtes Geld. Jede Zahl aus diesem Depot zählt in deine Bilanz, deine Rendite und die Kennzahlen, die Freunde sehen.',
  demo: 'Übungsgeld. Rechnet vollständig gegen das Papier-Startkapital, bleibt aber aus jeder Echtgeld-Kennzahl heraus — und wird nie geteilt.',
}

/**
 * Gespeicherten Text in eine Auswahl übersetzen.
 *
 * Unbekanntes, Leeres und ein `depot:` ohne gültige Zahl fallen auf das
 * Echtgeld-Aggregat zurück — NIE auf ein Demo-Depot. Im Zweifel soll die App
 * echte Zahlen zeigen; eine Übungszahl, die sich als echte ausgibt, ist der
 * Fehler, den es hier nicht mehr geben darf.
 */
export function parseScope(raw: string | null | undefined): Scope {
  if (!raw) return DEFAULT_SCOPE
  const v = raw.trim()
  if (v === AGGREGAT) return { type: 'alleEchtgeld' }
  if (v.startsWith(DEPOT_PREFIX)) {
    const id = Number(v.slice(DEPOT_PREFIX.length))
    if (Number.isInteger(id) && id > 0) return { type: 'depot', portfolioId: id }
  }
  return DEFAULT_SCOPE
}

/** Umkehrung von `parseScope` — was in `user_settings.activeScope` landet. */
export function formatScope(scope: Scope): string {
  return scope.type === 'alleEchtgeld' ? AGGREGAT : `${DEPOT_PREFIX}${scope.portfolioId}`
}

function isArchived(p: PortfolioLike): boolean {
  return p.archivedAt != null
}

/**
 * Welche Depot-IDs gehören zu dieser Auswahl?
 *
 * Beim Aggregat: alle nicht archivierten Echtgeld-Depots. Bei einem einzelnen
 * Depot: genau dieses — sofern es dem Nutzer gehört, weshalb hier ausschließlich
 * die bereits nach `userId` geladene Liste hereingegeben wird.
 *
 * Zeigt die Auswahl auf ein Depot, das es nicht (mehr) gibt, ist das Ergebnis
 * **leer** und nicht „alles". Ein verwaister Verweis darf keine fremden Zahlen
 * einblenden; die aufrufende Seite behandelt das über `resolveScope`.
 */
export function scopePortfolioIds(scope: Scope, portfolios: PortfolioLike[]): number[] {
  if (scope.type === 'depot') {
    return portfolios.some((p) => p.id === scope.portfolioId) ? [scope.portfolioId] : []
  }
  return portfolios
    .filter((p) => normalizePortfolioKind(p.kind) === 'echtgeld' && !isArchived(p))
    .map((p) => p.id)
}

/**
 * Rechnet diese Auswahl mit Papiergeld?
 *
 * Nur ein einzelnes Demo-Depot ist Papiergeld. Das Aggregat ist nie Papiergeld,
 * weil es Demo-Depots gar nicht enthält. Daran hängt die Kennzeichnung in der
 * Oberfläche — die einzige Stelle, die darüber entscheidet.
 */
export function isPaperScope(scope: Scope, portfolios: PortfolioLike[]): boolean {
  if (scope.type !== 'depot') return false
  const p = portfolios.find((x) => x.id === scope.portfolioId)
  return p != null && normalizePortfolioKind(p.kind) === 'demo'
}

/**
 * Die Auswahl gegen den tatsächlichen Bestand prüfen und notfalls heilen.
 *
 * Ein archiviertes oder gelöschtes Depot bleibt anwählbar, solange es existiert
 * (Historie). Zeigt die gespeicherte Auswahl aber auf ein Depot, das es nicht
 * mehr gibt, fällt sie auf das Aggregat zurück, statt eine leere Seite zu zeigen.
 * `changed` sagt der aufrufenden Seite, ob sie den geheilten Wert zurückschreiben
 * soll.
 */
export function resolveScope(
  raw: string | null | undefined,
  portfolios: PortfolioLike[],
): { scope: Scope; changed: boolean } {
  const parsed = parseScope(raw)
  if (parsed.type === 'depot' && !portfolios.some((p) => p.id === parsed.portfolioId)) {
    return { scope: DEFAULT_SCOPE, changed: true }
  }
  return { scope: parsed, changed: formatScope(parsed) !== (raw ?? '') }
}

/** Kann in diese Auswahl gebucht werden? In ein Aggregat nicht. */
export function isBookable(scope: Scope): scope is { type: 'depot'; portfolioId: number } {
  return scope.type === 'depot'
}

// --- Regeln der Depot-Verwaltung -------------------------------------------
// Alle als reine Prüfungen, damit Serveraktion und Oberfläche dieselbe Antwort
// geben und die Regeln testbar bleiben.

export const MAX_PORTFOLIO_NAME = 40

export type Rejection = { ok: false; reason: string }
export type Acceptance = { ok: true }
export type Verdict = Acceptance | Rejection

const ok: Acceptance = { ok: true }

/**
 * Name prüfen: nicht leer, nicht zu lang, im Konto eindeutig (unter den nicht
 * archivierten). Groß-/Kleinschreibung zählt nicht — zwei Depots „Comdirect" und
 * „comdirect" wären im Umschalter nicht unterscheidbar, und ein Umschalter, bei
 * dem man nicht weiß, wohin man bucht, ist genau das Ausgangsproblem.
 */
export function checkPortfolioName(
  name: string,
  existing: { id: number; name: string; archivedAt?: Date | string | null }[],
  selfId?: number,
): Verdict {
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, reason: 'Das Depot braucht einen Namen.' }
  if (trimmed.length > MAX_PORTFOLIO_NAME) {
    return { ok: false, reason: `Höchstens ${MAX_PORTFOLIO_NAME} Zeichen.` }
  }
  const clash = existing.some(
    (p) =>
      p.id !== selfId &&
      p.archivedAt == null &&
      p.name.trim().toLowerCase() === trimmed.toLowerCase(),
  )
  if (clash) return { ok: false, reason: `„${trimmed}" gibt es in deinem Konto schon.` }
  return ok
}

/**
 * Darf die Art dieses Depots noch geändert werden?
 *
 * Nein, sobald ein Trade daranhängt. Ein befülltes Echtgeld-Depot auf Demo
 * umzustellen würde rückwirkend die gesamte echte Bilanz umschreiben — aus
 * bezahlten Gebühren würde Papiergeld, aus realem Verlust Übung. Wer die Art
 * wirklich wechseln will, legt ein Depot an und bucht die Trades einzeln um; dann
 * ist jede Änderung sichtbar und einzeln bestätigt.
 */
export function checkKindChange(tradeCount: number): Verdict {
  if (tradeCount > 0) {
    return {
      ok: false,
      reason:
        'Die Art lässt sich nicht mehr ändern, weil schon Trades in diesem Depot liegen — das würde die Bilanz rückwirkend umschreiben. Lege stattdessen ein neues Depot an und buche die Trades einzeln um.',
    }
  }
  return ok
}

/**
 * Darf dieses Depot gelöscht werden?
 *
 * Nur wenn es leer ist. Ein befülltes Depot wird archiviert: Der Trade verlöre
 * sonst seine Handelsart und damit jede gültige Bilanz. Die Datenbank setzt das
 * zusätzlich mit `ON DELETE RESTRICT` durch (Migration 0022) — diese Prüfung
 * liefert nur den verständlichen Satz dazu.
 */
export function checkDeletable(tradeCount: number, cashflowCount: number): Verdict {
  if (tradeCount > 0 || cashflowCount > 0) {
    return {
      ok: false,
      reason:
        'Dieses Depot enthält Trades oder Zahlungen und wird deshalb nicht gelöscht, sondern archiviert — die Historie bleibt lesbar.',
    }
  }
  return ok
}

/**
 * Darf dieses Depot archiviert werden?
 *
 * Das letzte aktive Echtgeld-Depot nicht: Danach wäre das Echtgeld-Aggregat leer,
 * es gäbe kein Depot, in das ein echter Trade gebucht werden könnte, und die App
 * stünde ohne Bilanz da.
 */
export function checkArchivable(portfolio: PortfolioLike, all: PortfolioLike[]): Verdict {
  if (isArchived(portfolio)) return { ok: false, reason: 'Dieses Depot ist bereits archiviert.' }
  if (normalizePortfolioKind(portfolio.kind) === 'echtgeld') {
    const uebrige = all.filter(
      (p) =>
        p.id !== portfolio.id &&
        normalizePortfolioKind(p.kind) === 'echtgeld' &&
        !isArchived(p),
    )
    if (uebrige.length === 0) {
      return {
        ok: false,
        reason:
          'Das ist dein letztes aktives Echtgeld-Depot — ohne es hättest du keine Bilanz und keinen Ort für echte Trades. Lege zuerst ein weiteres an.',
      }
    }
  }
  return ok
}

/**
 * Was bedeutet es, einen Trade von einem Depot in ein anderes zu buchen?
 *
 * Kreuzt der Wechsel die Grenze Echtgeld ↔ Demo, ändert sich die Handelsart des
 * Trades — und damit die Bilanz BEIDER Depots. Das ist kein Nebeneffekt, den man
 * still ausführt, sondern die eigentliche Auskunft, die der Nutzer vorher braucht.
 * Deshalb liefert diese Funktion die Folgen, statt sie nur zu erlauben.
 */
export type MoveEffect = {
  /** Handelsart nach dem Umbuchen. */
  tradedWithMoney: boolean
  /** Wechselt der Trade die Grenze Echtgeld ↔ Demo? */
  crossesKind: boolean
  /**
   * Zählen die gespeicherten Gebühren nach dem Umbuchen noch?
   *
   * Bei Echtgeld → Demo nicht: Auf Papier fällt keine Gebühr an. Sie werden
   * deshalb ab dann IGNORIERT, aber ausdrücklich NICHT gelöscht — `tradeFees`
   * (`lib/trade-stats.ts`) und `settlePosition` (`lib/trade-events.ts`) prüfen
   * ohnehin `tradedWithMoney` und liefern 0. Ein Nullsetzen wäre Datenverlust:
   * Beim Zurückbuchen wären die tatsächlich gezahlten Gebühren für immer weg.
   * So bleibt jedes Umbuchen verlustfrei umkehrbar.
   */
  feesCount: boolean
}

export function moveEffect(from: PortfolioKind, to: PortfolioKind): MoveEffect {
  const zielIstEcht = to === 'echtgeld'
  return {
    tradedWithMoney: zielIstEcht,
    crossesKind: from !== to,
    feesCount: zielIstEcht,
  }
}

/** Darf dieser Trade in dieses Depot gebucht werden? */
export function checkMove(
  target: PortfolioLike | undefined,
  currentPortfolioId: number,
): Verdict {
  if (!target) return { ok: false, reason: 'Dieses Depot gibt es nicht.' }
  if (target.id === currentPortfolioId) {
    return { ok: false, reason: 'Der Trade liegt schon in diesem Depot.' }
  }
  if (isArchived(target)) {
    return {
      ok: false,
      reason: 'In ein archiviertes Depot wird nicht gebucht. Hole es zuerst zurück.',
    }
  }
  return ok
}
