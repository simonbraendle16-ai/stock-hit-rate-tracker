// Kontodeckung: Reicht das Depot für diesen Trade?
//
// Douglas-Perspektive: Das Risiko steht VOR dem Einstieg fest. Eine stille
// Überziehung ist das Gegenteil davon — sie verschiebt die Entscheidung auf den
// Moment, in dem der Broker die Position zwangsweise schließt. Deshalb wird hier
// abgelehnt, und zwar mit einer Begründung, die die Zahlen nennt: Wer nur
// „abgelehnt" liest, lernt nichts; wer „27.000 $ benötigt, 8.400 $ frei" liest,
// weiss beim nächsten Mal, wie viele Kontrakte gehen.
//
// Die Funktionen hier sind rein und ohne Datenbank — die Zeilen holt der
// Aufrufer (`app/actions/trades.ts`, `lib/demo-run.ts`).

/** Bedeutung: 1 Einheit der Fremdwährung entspricht so vielen Kontowährungs-Einheiten. */
export type FxRates = Record<string, number>

/**
 * Umrechnungskurse aus dem Depot lesen. Kaputtes JSON, unsinnige Werte und
 * fremde Typen fallen weg — ein erfundener Kurs wäre schlimmer als keiner.
 */
export function parseFxRates(raw: string | null | undefined): FxRates {
  if (!raw) return {}
  try {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const out: FxRates = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const code = k.trim().toUpperCase()
      if (code.length < 2 || code.length > 5) continue
      if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) continue
      out[code] = val
    }
    return out
  } catch {
    return {}
  }
}

export type Umrechnung =
  | { ok: true; wert: number; kurs: number }
  | { ok: false; grund: string }

/**
 * Einen Betrag in die Kontowährung umrechnen.
 *
 * Ohne gepflegten Kurs wird NICHT geraten. Die App rechnet Währungen sonst
 * nirgends um; ein 1:1-Vergleich von USD gegen EUR wäre knapp zehn Prozent
 * falsch und damit genau die plausible Falschzahl, die hier nie entstehen soll.
 */
export function umrechnen(
  betrag: number,
  von: string,
  nach: string,
  rates: FxRates,
): Umrechnung {
  const a = (von ?? '').trim().toUpperCase()
  const b = (nach ?? '').trim().toUpperCase()
  if (!a || !b) return { ok: false, grund: 'Währung unbekannt.' }
  if (a === b) return { ok: true, wert: betrag, kurs: 1 }
  const kurs = rates[a]
  if (kurs == null) {
    return {
      ok: false,
      grund: `Für ${a} ist am Depot kein Umrechnungskurs hinterlegt — ohne ihn lässt sich ${a} nicht gegen ${b} prüfen.`,
    }
  }
  return { ok: true, wert: betrag * kurs, kurs }
}

export type DeckungsEingabe = {
  /** Startkapital des Depots. */
  startCapital: number
  /** Nettosumme der Ein-/Auszahlungen (Einzahlung positiv). */
  netCashflow: number
  /** Realisierte P&L aller abgeschlossenen Trades des Depots. */
  realisiertePnl: number
  /** Bereits gebundener Einschuss offener und geplanter Kontrakt-Trades, in Kontowährung. */
  gebundeneMargin: number
}

export type Deckung = {
  /** Startkapital + Ein-/Auszahlungen + realisierte P&L. */
  kontostand: number
  gebundeneMargin: number
  /** Was noch als Einschuss zur Verfügung steht. Kann negativ sein. */
  frei: number
}

export function berechneDeckung(e: DeckungsEingabe): Deckung {
  const kontostand = num(e.startCapital) + num(e.netCashflow) + num(e.realisiertePnl)
  const gebundeneMargin = Math.max(0, num(e.gebundeneMargin))
  return { kontostand, gebundeneMargin, frei: kontostand - gebundeneMargin }
}

export type DeckungsPruefung =
  | { ok: true; benoetigt: number; frei: number; hinweis?: string }
  | { ok: false; grund: string; benoetigt: number; frei: number }

/**
 * Die Prüfung selbst.
 *
 * Drei Ausgänge, und alle drei sind ehrlich:
 *   - **gedeckt** → durch.
 *   - **nicht gedeckt** → Ablehnung mit Zahlen.
 *   - **nicht prüfbar** (Fremdwährung ohne Kurs) → durch, aber MIT Hinweis.
 *     Ein Trade wird nicht daran gehindert, dass die App etwas nicht weiss;
 *     verschwiegen wird es aber auch nicht.
 */
export function pruefeDeckung(args: {
  /** Benötigter Einschuss in der Kontraktwährung. */
  einschuss: number
  /** Währung des Einschusses. */
  waehrung: string
  /** Kontowährung. */
  kontowaehrung: string
  rates: FxRates
  deckung: Deckung
  /** Für die Begründung: welches Instrument, wie viele Kontrakte. */
  label?: string
}): DeckungsPruefung {
  const { deckung } = args
  const einschuss = Math.max(0, num(args.einschuss))
  if (einschuss === 0) return { ok: true, benoetigt: 0, frei: deckung.frei }

  const u = umrechnen(einschuss, args.waehrung, args.kontowaehrung, args.rates)
  if (!u.ok) {
    return {
      ok: true,
      benoetigt: einschuss,
      frei: deckung.frei,
      hinweis: `${u.grund} Der Trade wurde deshalb NICHT gegen die Depotdeckung geprüft.`,
    }
  }

  if (u.wert <= deckung.frei) return { ok: true, benoetigt: u.wert, frei: deckung.frei }

  const was = args.label ? `${args.label}: ` : ''
  return {
    ok: false,
    benoetigt: u.wert,
    frei: deckung.frei,
    grund:
      `${was}Der Einschuss von ${geld(u.wert, args.kontowaehrung)} übersteigt den freien Einschuss ` +
      `von ${geld(deckung.frei, args.kontowaehrung)} ` +
      `(Kontostand ${geld(deckung.kontostand, args.kontowaehrung)}, bereits gebunden ` +
      `${geld(deckung.gebundeneMargin, args.kontowaehrung)}).`,
  }
}

/**
 * Wie viele Kontrakte die Deckung noch hergibt — die konstruktive Hälfte der
 * Ablehnung. Eine Absage ohne die Zahl, die gegangen wäre, ist nur halb hilfreich.
 */
export function maxKontrakte(args: {
  einschussJeKontrakt: number
  waehrung: string
  kontowaehrung: string
  rates: FxRates
  frei: number
}): number | null {
  const je = num(args.einschussJeKontrakt)
  if (je <= 0) return null
  const u = umrechnen(je, args.waehrung, args.kontowaehrung, args.rates)
  if (!u.ok) return null
  if (u.wert <= 0) return null
  return Math.max(0, Math.floor(args.frei / u.wert))
}

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function geld(v: number, waehrung: string): string {
  const gerundet = Math.round(v * 100) / 100
  return `${gerundet.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${waehrung}`
}
