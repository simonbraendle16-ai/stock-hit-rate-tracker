// Teilziele (Etappe 13) — reine Logik über die geplanten Ausstiegsstufen eines
// Trades. Bewusst OHNE 'use server', ohne DB und ohne React, damit sie direkt
// testbar ist (`lib/trade-targets.test.ts`) und Formular (Live-Vorschau) und
// Server-Action (harte Prüfung) dieselbe Quelle benutzen — nicht zwei Regeln,
// die auseinanderlaufen.
//
// Leitidee: Ein Ausstieg in Stufen ist Douglas-konform, solange die Stufen VOR
// dem Einstieg feststehen. Deshalb wird hier beim Planen streng geprüft
// (Profitseite, Anteile, Dubletten) und nicht erst beim Ausführen — und deshalb
// bringt die Reihenfolge diese Datei selbst in Ordnung, statt sie vom Formular
// zu verlangen.

import type { trade, tradeTarget } from '@/lib/db/schema'

export type TradeRow = typeof trade.$inferSelect
export type TradeTargetRow = typeof tradeTarget.$inferSelect

/** Höchstzahl der Stufen je Trade — Teilziele UND Kursziel zusammen. Vier decken
 *  jeden üblichen Staffel-Ausstieg ab (z. B. 25/25/25/25); mehr wäre eine
 *  Kurstabelle, kein Plan. */
export const MAX_TARGETS = 4

/**
 * Höchstzahl der TEILziele — eine weniger, denn das Kursziel belegt die letzte
 * Stufe.
 *
 * Die Konstante steht hier und wird nicht an jeder Stelle als `MAX_TARGETS - 1`
 * ausgerechnet: Genau dieses Abziehen wurde beim Umbau vergessen. Das Formular
 * bot weiter vier Teilziele an, der Server zählte das Kursziel mit und wies
 * fünf Stufen ab — der Nutzer lief in eine Fehlermeldung, die ihm obendrein
 * eine falsche Obergrenze nannte.
 */
export const MAX_TEILZIELE = MAX_TARGETS - 1

export type Direction = 'long' | 'short'

/** Was beim Planen hereinkommt — Kurs und Anteil der Anfangsposition. */
export type TargetPlanInput = {
  price: number
  sharePct: number
  note?: string | null
}

/**
 * Eine Stufe, wie sie angezeigt und ausgeführt wird. `id === null` heißt:
 * implizit aus `trade.takeProfit` abgeleitet (Trade ohne eigene Stufen-Zeilen,
 * also der gesamte Altbestand) — eine solche Stufe kann nicht einzeln
 * ausgeführt werden, sie IST der ganze Plan.
 */
export type EffectiveTarget = {
  id: number | null
  sortOrder: number
  price: number
  sharePct: number
  executedAt: Date | null
  executedPrice: number | null
  executedQty: number | null
  note: string | null
}

const EPS = 1e-9

/** Liegt der Kurs auf der Gewinnseite des Einstiegs? Gleichstand zählt nicht. */
export function isProfitSide(direction: string, entry: number, price: number): boolean {
  return direction === 'short' ? price < entry - EPS : price > entry + EPS
}

/** Abstand eines Ziels zum Einstieg — die Sortiergröße (Stufe 1 = am nächsten). */
function distance(entry: number, price: number): number {
  return Math.abs(price - entry)
}

/**
 * Prüft und ordnet die geplanten Stufen. Wirft mit sprechender deutscher
 * Meldung, statt still etwas zurechtzubiegen: Eine stumm korrigierte Zielstufe
 * wäre ein Plan, den der Nutzer nie so beschlossen hat.
 *
 * Sortiert wird nach Abstand zum Einstieg — die Reihenfolge im Formular ist
 * Eingabereihenfolge, nicht Aussage.
 *
 * Die Summe der Anteile darf unter 100 % bleiben: Wer einen Teil laufen lassen
 * will, plant das ausdrücklich. Der Rest wird bis zur LETZTEN Stufe gehalten —
 * so rechnet auch `blendedRiskReward`.
 */
export function normalizeTargets(args: {
  entry: number
  stopLoss: number
  direction: string
  targets: TargetPlanInput[]
}): TargetPlanInput[] {
  const { entry, stopLoss, direction, targets } = args
  if (targets.length === 0) return []
  if (targets.length > MAX_TARGETS) {
    // „Stufen", nicht „Teilziele": Seit das Kursziel die letzte Stufe ist,
    // zählt es hier mit. Der alte Text nannte eine Obergrenze, die es so nicht
    // gibt, und schickte den Nutzer damit auf die falsche Fährte.
    throw new Error(
      `Höchstens ${MAX_TARGETS} Stufen je Trade — das Kursziel zählt als eine davon.`,
    )
  }
  if (!Number.isFinite(entry) || entry <= 0) {
    throw new Error('Teilziele brauchen einen gültigen Einstiegskurs.')
  }
  if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
    throw new Error('Teilziele brauchen einen gültigen Stop-Loss.')
  }

  const seiten = direction === 'short' ? 'unter' : 'über'
  let summe = 0

  const geprueft = targets.map((t, i) => {
    const nr = i + 1
    if (!Number.isFinite(t.price) || t.price <= 0) {
      throw new Error(`Teilziel ${nr}: Bitte einen Kurs größer als 0 eintragen.`)
    }
    if (!isProfitSide(direction, entry, t.price)) {
      throw new Error(`Teilziel ${nr} muss ${seiten} dem Einstieg liegen.`)
    }
    if (!Number.isFinite(t.sharePct) || t.sharePct <= 0) {
      throw new Error(`Teilziel ${nr}: Bitte einen Anteil größer als 0 % eintragen.`)
    }
    if (t.sharePct > 100) {
      throw new Error(`Teilziel ${nr}: Mehr als 100 % der Position gibt es nicht.`)
    }
    summe += t.sharePct
    return { price: t.price, sharePct: t.sharePct, note: t.note?.trim() || null }
  })

  if (summe > 100 + EPS) {
    throw new Error(
      `Die Teilziele geben zusammen ${summe.toLocaleString('de-DE', {
        maximumFractionDigits: 2,
      })} % der Position ab — mehr als die Position groß ist.`,
    )
  }

  const sortiert = [...geprueft].sort(
    (a, b) => distance(entry, a.price) - distance(entry, b.price),
  )

  for (let i = 1; i < sortiert.length; i++) {
    if (Math.abs(sortiert[i].price - sortiert[i - 1].price) < EPS) {
      throw new Error(
        `Zwei Teilziele auf demselben Kurs (${sortiert[i].price}) — bitte zusammenfassen.`,
      )
    }
  }

  return sortiert
}

/** Wie viel Prozent der Position über die letzte Stufe hinaus laufen würden. */
export function remainderPct(targets: { sharePct: number }[]): number {
  const summe = targets.reduce((acc, t) => acc + t.sharePct, 0)
  const rest = 100 - summe
  return rest < EPS ? 0 : rest
}

/**
 * Kursziel + optionale Teilziele → der vollständige Plan.
 *
 * **Warum es diese Funktion gibt, obwohl es `normalizeTargets` schon gab.**
 * Bisher war ein Trade entweder „ein Ziel" oder „eine Liste von Stufen", und
 * `trade.takeProfit` trug in der Liste die **nächstliegende** Stufe. Damit stand
 * überall, wo die App „Ziel" sagt — Chance-Risiko-Verhältnis, Kurs-Wecker, der
 * Balken Stop↔Ziel, der Bot-Zwilling —, das **erste Teilziel** statt des
 * Kursziels. Bei einem realen Trade mit den Stufen 200 / 190 wurde als Ziel 200
 * geführt, obwohl der Plan auf 190 hinauslief.
 *
 * Ab hier gibt es nur noch eine Lesart, und sie ist die des Traders:
 *
 *   **Das Kursziel ist Pflicht und ist die äußerste Stufe. Teilziele sind
 *   optional und liegen davor.**
 *
 * Das macht das Modell nicht nur verständlicher, sondern auch vollständig: Ein
 * Trade hat *immer* ein Ziel, also ist das CRV immer rechenbar, der Wecker immer
 * setzbar und der Bot-Zwilling immer simulierbar. Vorher konnte all das an einem
 * fehlenden `takeProfit` still ausfallen.
 *
 * **Der nicht verteilte Rest gehört dem Kursziel.** Wer 50 % auf ein Teilziel
 * legt, gibt die restlichen 50 % nicht auf — er lässt sie bis zum Ziel laufen.
 * Genau so hat `blendedRiskReward` den Rest immer schon gerechnet; hier wird er
 * jetzt auch *geschrieben*, damit die Anteile sichtbar auf 100 % aufgehen statt
 * eine Lücke zu lassen, über die niemand entschieden hat.
 */
export function buildTargetPlan(args: {
  entry: number
  stopLoss: number
  direction: string
  /** Das Kursziel — Pflicht. */
  kursziel: number
  /** Teilziele davor. Leer heißt: ein Ziel, wie bei jedem einfachen Trade. */
  teilziele?: TargetPlanInput[]
  /** Anmerkung am Kursziel. */
  note?: string | null
}): TargetPlanInput[] {
  const { entry, stopLoss, direction, kursziel } = args
  const teilziele = args.teilziele ?? []

  if (!Number.isFinite(kursziel) || kursziel <= 0) {
    throw new Error('Bitte ein Kursziel größer als 0 eintragen.')
  }
  // Vor `normalizeTargets` geprüft, damit die Meldung die Grenze nennt, die
  // den Nutzer betrifft: Er gibt TEILziele ein, das Kursziel steht im Feld
  // darüber. „Höchstens 4 Stufen" wäre richtig gerechnet und trotzdem eine
  // Zahl, die er nirgends abzählen kann.
  if (teilziele.length > MAX_TEILZIELE) {
    throw new Error(
      `Höchstens ${MAX_TEILZIELE} Teilziele — zusammen mit dem Kursziel sind das ` +
        `${MAX_TARGETS} Stufen.`,
    )
  }
  if (!isProfitSide(direction, entry, kursziel)) {
    throw new Error(
      direction === 'short'
        ? 'Bei Short muss das Kursziel unter dem Einstieg liegen.'
        : 'Bei Long muss das Kursziel über dem Einstieg liegen.',
    )
  }
  // Ein Teilziel jenseits des Kursziels ist kein Teilziel mehr — dann ist es
  // das Ziel. Das still umzusortieren wäre ein Plan, den niemand beschlossen
  // hat; deshalb die Rückfrage per Fehlermeldung.
  const zielAbstand = distance(entry, kursziel)
  teilziele.forEach((t, i) => {
    if (Number.isFinite(t.price) && distance(entry, t.price) > zielAbstand + EPS) {
      throw new Error(
        `Teilziel ${i + 1} liegt weiter vom Einstieg entfernt als das Kursziel — ` +
          'dann ist es das Kursziel. Bitte die beiden tauschen.',
      )
    }
  })

  // Die Summe der TEILziele wird hier geprüft, nicht erst in
  // `normalizeTargets`: Dort hieße die Meldung „mehr als die Position groß
  // ist" — richtig gerechnet, aber am Problem vorbei. Wer 60 + 40 verteilt, hat
  // die Position nicht überzeichnet, er hat nur nichts für sein Ziel übrig
  // gelassen. Eine Fehlermeldung, die den falschen Grund nennt, schickt den
  // Nutzer an die falsche Stelle.
  const teilSumme = teilziele.reduce(
    (a, t) => a + (Number.isFinite(t.sharePct) ? t.sharePct : 0),
    0,
  )
  if (teilSumme >= 100 - EPS) {
    throw new Error(
      'Die Teilziele geben schon die ganze Position ab — für das Kursziel bleibt nichts übrig.',
    )
  }

  // Geprüft und sortiert wird über DIESELBE Funktion wie bisher; sie kennt die
  // Seiten-, Dubletten- und Anteilsregeln bereits. Das Kursziel läuft mit
  // Anteil 0 mit und bekommt seinen echten Anteil erst unten — sonst würde es
  // die 100-%-Grenze schon vor der Restverteilung sprengen.
  const alle = normalizeTargets({
    entry,
    stopLoss,
    direction,
    targets: [
      ...teilziele,
      { price: kursziel, sharePct: SPAETER, note: args.note ?? null },
    ],
  })

  const idx = alle.findIndex((t) => Math.abs(t.price - kursziel) < EPS)
  if (idx < 0) throw new Error('Das Kursziel ist aus dem Plan gefallen.')

  const vergeben = alle.reduce((a, t, i) => (i === idx ? a : a + t.sharePct), 0)
  return alle.map((t, i) => (i === idx ? { ...t, sharePct: 100 - vergeben } : t))
}

/**
 * Platzhalter-Anteil des Kursziels, solange die Teilziele noch nicht gezählt
 * sind. Bewusst winzig statt 0: `normalizeTargets` weist einen Anteil von 0
 * zurück, und diese Prüfung soll für echte Eingaben scharf bleiben.
 */
const SPAETER = 1e-6

/**
 * Die Stufen, die für diesen Trade gelten. Hat er eigene Zeilen, sind es diese.
 * Hat er keine (Altbestand oder Trade ohne Ziel), wird `trade.takeProfit` als
 * EINE implizite Stufe gelesen — mit `takeProfitPct` als Anteil, denn genau das
 * war dieses Feld schon immer. So ändert sich für keinen bestehenden Trade
 * irgendetwas, und die Anzeige hat trotzdem nur einen Weg.
 */
export function effectiveTargets(t: TradeRow, rows: TradeTargetRow[]): EffectiveTarget[] {
  if (rows.length > 0) {
    return [...rows]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .map((r, i) => ({
        id: r.id,
        sortOrder: i,
        price: r.price,
        sharePct: r.sharePct,
        executedAt: r.executedAt ? new Date(r.executedAt) : null,
        executedPrice: r.executedPrice ?? null,
        executedQty: r.executedQty ?? null,
        note: r.note ?? null,
      }))
  }
  if (t.takeProfit == null) return []
  return [
    {
      id: null,
      sortOrder: 0,
      price: t.takeProfit,
      sharePct: t.takeProfitPct ?? 100,
      executedAt: null,
      executedPrice: null,
      executedQty: null,
      note: null,
    },
  ]
}

/**
 * Chance-Risiko-Verhältnis über MEHRERE Stufen — nach Anteilen gewichtet.
 *
 * Ein Staffel-Ausstieg hat kein einzelnes R:R: Die erste Stufe bringt weniger,
 * die letzte mehr. Die ehrliche Zahl ist der gewichtete Durchschnitt, denn genau
 * so viel bringt der Plan, wenn er aufgeht. Ein Rest ohne eigene Stufe wird
 * dabei der LETZTEN Stufe zugeschlagen — er läuft ja bis dorthin.
 *
 * Bei genau einer Stufe kommt exakt `computeRiskReward` heraus; deshalb ändert
 * sich für Trades mit einem Ziel nichts.
 */
export function blendedRiskReward(args: {
  entry: number
  stopLoss: number
  targets: { price: number; sharePct: number }[]
}): number | null {
  const { entry, stopLoss, targets } = args
  if (targets.length === 0) return null
  const risiko = Math.abs(entry - stopLoss)
  if (!(risiko > EPS)) return null

  const rest = remainderPct(targets)
  let summe = 0
  targets.forEach((t, i) => {
    const anteil = t.sharePct + (i === targets.length - 1 ? rest : 0)
    summe += (anteil / 100) * (Math.abs(t.price - entry) / risiko)
  })
  return Number.isFinite(summe) ? summe : null
}

/**
 * Stückzahl, die auf einer Stufe abgegeben wird. Bezug ist die ANFANGSposition —
 * der Plan wurde auf ihr gemacht, und nur so ergeben 50/30/20 zusammen wieder
 * die ganze Position. Ein späterer Nachkauf verschiebt die Stufen nicht.
 */
export function plannedQty(basisQty: number, sharePct: number): number {
  if (!Number.isFinite(basisQty) || basisQty <= 0) return 0
  return (basisQty * sharePct) / 100
}

export type TargetProgress = {
  /** Anzahl Stufen insgesamt. */
  total: number
  /** Davon bereits ausgeführt. */
  executed: number
  /** Anteil der Position, der über ausgeführte Stufen realisiert wurde (%). */
  executedPct: number
  /** Anteil, der noch auf seine Stufe wartet (%, ohne den freien Rest). */
  openPct: number
  /** Anteil ohne eigene Stufe — läuft bis zur letzten (%). */
  remainderPct: number
  /** Nächste offene Stufe (die nächste Entscheidung, die schon getroffen ist). */
  next: EffectiveTarget | null
  /** true, sobald jede Stufe abgerechnet ist. */
  allExecuted: boolean
}

/** Wo steht der Staffel-Ausstieg gerade? Reine Ableitung, keine Rechnung mit Geld. */
export function targetProgress(targets: EffectiveTarget[]): TargetProgress {
  const executed = targets.filter((t) => t.executedAt != null)
  const open = targets.filter((t) => t.executedAt == null)
  return {
    total: targets.length,
    executed: executed.length,
    executedPct: executed.reduce((a, t) => a + t.sharePct, 0),
    openPct: open.reduce((a, t) => a + t.sharePct, 0),
    remainderPct: remainderPct(targets),
    next: open[0] ?? null,
    allExecuted: targets.length > 0 && open.length === 0,
  }
}
