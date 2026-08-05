/**
 * Fibonacci-Werkzeuge: welche Levels, wie beschriftet, wie weit gezeichnet.
 *
 * Vorher standen sieben Levels als Konstante in der Zeichenebene. Damit war
 * das Werkzeug für echte Arbeit unbrauchbar: Wer mit 1,272 und 1,618 arbeitet,
 * konnte sie nicht bekommen; wer 0,236 nicht sehen will, wurde sie nicht los;
 * und die Linien endeten am zweiten Klickpunkt, sodass man nie sah, wo der
 * Kurs später auf ein Level trifft — der einzige Grund, ein Retracement
 * überhaupt zu zeichnen.
 *
 * Alles hier ist reine Logik über fremde Daten (die Einstellung liegt als JSON
 * an der Zeichnung). Gelesen wird deshalb **ausschließlich** über
 * `normalizeFibStil`, nach demselben Muster wie `lib/chart-appearance.ts`:
 * Jedes Feld einzeln geprüft, Ungültiges fällt auf den Standard. Eine ältere
 * gespeicherte Zeichnung bleibt nach einer Erweiterung gültig, statt zu
 * verschwinden.
 */

import { CHART_COLORS } from '@/components/chart/colors'

/** Farben müssen geprüft sein, bevor sie in SVG-Attribute gehen. */
const FARB_MUSTER = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/

export interface FibLevel {
  /** Verhältnis, z. B. 0.618. Negativ und > 1 sind erlaubt. */
  wert: number
  /** Sichtbar? Ausgeschaltete Levels bleiben erhalten, damit man sie wiederfindet. */
  an: boolean
  /** Eigene Farbe; fehlt sie, gilt die Farbe der Zeichnung. */
  farbe?: string
}

export type FibBeschriftung = 'preis' | 'prozent' | 'beides' | 'aus'

export interface FibStil {
  levels: FibLevel[]
  /**
   * Linien nach rechts bis zum Chartrand verlängern.
   *
   * Standard **an**. Genau das hat gefehlt: Ein Retracement, dessen Linien am
   * zweiten Klickpunkt aufhören, beantwortet die Frage nicht, auf die man es
   * zeichnet — nämlich wo der Kurs, der noch kommt, darauf trifft.
   */
  verlaengern: boolean
  beschriftung: FibBeschriftung
  /** Grundfarbe der Zeichnung. */
  farbe: string
  /** Linienstärke in px. */
  staerke: number
  /** Flächen zwischen benachbarten Levels blass einfärben. */
  flaeche: boolean
}

const grenze = (v: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

const farbeOk = (v: unknown): v is string =>
  typeof v === 'string' && FARB_MUSTER.test(v.trim())

/** Retracement: die Standardlevels nach Frost & Prechter, plus die üblichen Ziele. */
export const DEFAULT_FIB: FibStil = {
  levels: [
    { wert: 0, an: true },
    { wert: 0.236, an: true },
    { wert: 0.382, an: true },
    { wert: 0.5, an: true },
    { wert: 0.618, an: true },
    { wert: 0.786, an: true },
    { wert: 1, an: true },
    // Aus, aber vorhanden: ein Klick genügt, statt sie eintippen zu müssen.
    { wert: 1.272, an: false },
    { wert: 1.618, an: false },
    { wert: 2.618, an: false },
    { wert: -0.618, an: false },
  ],
  verlaengern: true,
  beschriftung: 'beides',
  farbe: CHART_COLORS.warning,
  staerke: 1,
  flaeche: false,
}

/** Trendbasierte Extension (3 Punkte A/B/C) — TradingView-Standard. */
export const DEFAULT_FIBEXT: FibStil = {
  levels: [
    { wert: 0, an: true },
    { wert: 0.382, an: true },
    { wert: 0.618, an: true },
    { wert: 1, an: true },
    { wert: 1.272, an: false },
    { wert: 1.382, an: true },
    { wert: 1.618, an: true },
    { wert: 2, an: true },
    { wert: 2.618, an: true },
  ],
  verlaengern: true,
  beschriftung: 'beides',
  farbe: CHART_COLORS.warning,
  staerke: 1,
  flaeche: false,
}

const BESCHRIFTUNGEN: FibBeschriftung[] = ['preis', 'prozent', 'beides', 'aus']

/** Höchstzahl Levels je Zeichnung — darüber ist der Chart nur noch Streifen. */
export const MAX_FIB_LEVELS = 24

/**
 * Fremde Daten -> gültiger Stil. Fällt für jedes Feld einzeln auf den
 * Standard zurück; wirft nie.
 */
export function normalizeFibStil(raw: unknown, standard: FibStil = DEFAULT_FIB): FibStil {
  const d: FibStil = {
    ...standard,
    levels: standard.levels.map((l) => ({ ...l })),
  }
  if (!raw || typeof raw !== 'object') return d
  const o = raw as Record<string, unknown>

  if (Array.isArray(o.levels)) {
    const gesehen = new Set<number>()
    const levels: FibLevel[] = []
    for (const eintrag of o.levels) {
      if (!eintrag || typeof eintrag !== 'object') continue
      const e = eintrag as Record<string, unknown>
      const wert = typeof e.wert === 'number' ? e.wert : Number.NaN
      if (!Number.isFinite(wert) || wert < -10 || wert > 10) continue
      // Auf drei Stellen normalisiert, damit 0.6180001 und 0.618 dasselbe Level sind.
      const rund = Math.round(wert * 1000) / 1000
      if (gesehen.has(rund)) continue
      gesehen.add(rund)
      levels.push({
        wert: rund,
        an: e.an !== false,
        ...(farbeOk(e.farbe) ? { farbe: e.farbe.trim() } : {}),
      })
      if (levels.length >= MAX_FIB_LEVELS) break
    }
    // Ein leeres Ergebnis wäre eine unsichtbare Zeichnung — dann lieber der Standard.
    if (levels.length > 0) d.levels = levels
  }

  if (typeof o.verlaengern === 'boolean') d.verlaengern = o.verlaengern
  if (typeof o.flaeche === 'boolean') d.flaeche = o.flaeche
  if (typeof o.beschriftung === 'string' && BESCHRIFTUNGEN.includes(o.beschriftung as FibBeschriftung)) {
    d.beschriftung = o.beschriftung as FibBeschriftung
  }
  if (farbeOk(o.farbe)) d.farbe = o.farbe.trim()
  if (typeof o.staerke === 'number') d.staerke = grenze(o.staerke, 0.5, 4, standard.staerke)

  return d
}

export interface FibLinie {
  wert: number
  preis: number
  farbe: string
  label: string
  /** 0 und 1 sind die Basis der Messung und werden kräftiger gezeichnet. */
  betont: boolean
}

/** Kursformat nach Größenordnung — dieselbe Regel wie im Trainer-Formular. */
function alsKurs(v: number): string {
  const abs = Math.abs(v)
  const stellen = abs >= 100 ? 2 : abs >= 1 ? 4 : 6
  return v.toLocaleString('de-DE', {
    minimumFractionDigits: stellen,
    maximumFractionDigits: stellen,
  })
}

function alsProzent(wert: number): string {
  const p = wert * 100
  const s = p.toLocaleString('de-DE', { maximumFractionDigits: 1 })
  return `${s} %`
}

/**
 * Die zu zeichnenden Linien.
 *
 * `von`/`bis` spannen die Messung auf: Beim Retracement sind das die beiden
 * Klickpunkte, bei der Extension der Ursprung C und C + (B − A). Dadurch
 * rechnen beide Werkzeuge über **dieselbe** Formel — zwei Formeln wären zwei
 * Gelegenheiten, verschieden zu runden.
 */
export function fibLinien(stil: FibStil, von: number, bis: number): FibLinie[] {
  const spanne = bis - von
  return stil.levels
    .filter((l) => l.an)
    .map((l) => {
      const preis = von + spanne * l.wert
      const zahl = l.wert.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
      let label: string
      if (stil.beschriftung === 'aus') label = ''
      else if (stil.beschriftung === 'preis') label = `${zahl} · ${alsKurs(preis)}`
      else if (stil.beschriftung === 'prozent') label = `${zahl} (${alsProzent(l.wert)})`
      else label = `${zahl} · ${alsKurs(preis)} (${alsProzent(l.wert)})`
      return {
        wert: l.wert,
        preis,
        farbe: l.farbe ?? stil.farbe,
        label,
        betont: l.wert === 0 || l.wert === 1,
      }
    })
    .sort((a, b) => a.wert - b.wert)
}

/** Ein Level ein-/ausschalten. Rein, damit die Oberfläche nichts rechnet. */
export function toggleLevel(stil: FibStil, wert: number): FibStil {
  return {
    ...stil,
    levels: stil.levels.map((l) => (l.wert === wert ? { ...l, an: !l.an } : l)),
  }
}

/**
 * Eigenes Level ergänzen. Ein bereits vorhandenes wird nur eingeschaltet —
 * sonst stünde dasselbe Verhältnis zweimal in der Liste.
 */
export function addLevel(stil: FibStil, wert: number): FibStil {
  if (!Number.isFinite(wert) || wert < -10 || wert > 10) return stil
  const rund = Math.round(wert * 1000) / 1000
  const vorhanden = stil.levels.find((l) => l.wert === rund)
  if (vorhanden) {
    return { ...stil, levels: stil.levels.map((l) => (l.wert === rund ? { ...l, an: true } : l)) }
  }
  if (stil.levels.length >= MAX_FIB_LEVELS) return stil
  return {
    ...stil,
    levels: [...stil.levels, { wert: rund, an: true }].sort((a, b) => a.wert - b.wert),
  }
}

/** Eigenes Level entfernen. */
export function removeLevel(stil: FibStil, wert: number): FibStil {
  const rest = stil.levels.filter((l) => l.wert !== wert)
  return rest.length > 0 ? { ...stil, levels: rest } : stil
}
