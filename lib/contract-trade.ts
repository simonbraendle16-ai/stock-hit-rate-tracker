// Die Brücke zwischen Kontrakt-Spezifikation und Trade-Zeile.
//
// Reine Funktionen, damit sowohl die Server-Actions (`app/actions/trades.ts`)
// als auch der Demo-Sammellauf (`lib/demo-run.ts`) denselben Weg gehen. Zwei
// Stellen, die dieselbe Umrechnung selbst machen, laufen früher oder später
// auseinander — und dann hängt die Trefferquote davon ab, wer gebucht hat.

import {
  contractMultiplier,
  resolveContractSpec,
  type ContractSpec,
  type ContractSpecOverride,
} from './contract-specs'
import { berechneDeckung, umrechnen, type Deckung, type FxRates } from './margin'
import { contractPositionSize, contractRisk, requiredMargin } from './trade-math'

/** Die Spalten des Instruments, die eine Spezifikation tragen können. */
export type StockContractRow = {
  ticker: string
  market?: string | null
  contractTickSize?: number | null
  contractTickValue?: number | null
  contractSize?: number | null
  contractCurrency?: string | null
  contractMarginModel?: string | null
  contractInitialMargin?: number | null
  contractMaintenanceMargin?: number | null
  contractMaintenanceRate?: number | null
  contractsDisabled?: boolean | null
}

function handeingabe(row: StockContractRow): ContractSpecOverride {
  return {
    tickSize: row.contractTickSize,
    tickValue: row.contractTickValue,
    contractSize: row.contractSize,
    currency: row.contractCurrency,
    marginModel: row.contractMarginModel,
    initialMargin: row.contractInitialMargin,
    maintenanceMargin: row.contractMaintenanceMargin,
    maintenanceRate: row.contractMaintenanceRate,
    disabled: row.contractsDisabled,
  }
}

/**
 * Die gültige Spezifikation eines Instruments — Vorgabe per Kontrakt-Wurzel,
 * feldweise überschrieben von dem, was am Instrument steht. Der EINE Weg;
 * `CONTRACT_SPECS` nie direkt auslesen.
 */
export function specFromStock(row: StockContractRow | null | undefined): ContractSpec | null {
  if (!row) return null
  return resolveContractSpec({
    ticker: row.ticker,
    market: row.market,
    hand: handeingabe(row),
  })
}

/** Die Spalten, die ein Kontrakt-Trade an sich trägt — beim Anlegen eingefroren. */
export type ContractTradeFelder = {
  contracts: number
  contractTickSize: number
  contractTickValue: number
  contractMultiplier: number
  contractCurrency: string
  /** Einschuss ALLER Kontrakte, in der Kontraktwährung. */
  contractInitialMargin: number
  /** Was am Trade in `positionSize` landet: Kontrakte × Multiplikator. */
  positionSize: number
  /** Geplantes Risiko in der Kontraktwährung — Ticks × Tick-Wert × Kontrakte. */
  risiko: number
}

/**
 * Aus Spezifikation und Kontraktzahl die Trade-Spalten ableiten.
 *
 * `positionSize` ist der Kern: Dadurch bleibt der bestehende Rechenweg
 * `(Ausstieg − Einstieg) × positionSize` in trade-stats, trade-events,
 * excursion und bot-twin unverändert richtig.
 */
export function contractTradeFelder(args: {
  spec: ContractSpec
  contracts: number
  entryPrice: number
  stopLoss: number
  leverage?: number | null
}): ContractTradeFelder | null {
  const n = Number(args.contracts)
  if (!Number.isFinite(n) || n <= 0) return null
  const { spec } = args
  return {
    contracts: n,
    contractTickSize: spec.tickSize,
    contractTickValue: spec.tickValue,
    contractMultiplier: contractMultiplier(spec),
    contractCurrency: spec.currency,
    contractInitialMargin: requiredMargin({
      spec,
      contracts: n,
      entry: args.entryPrice,
      leverage: args.leverage ?? 1,
    }),
    positionSize: contractPositionSize(n, spec),
    risiko: contractRisk({
      entry: args.entryPrice,
      stopLoss: args.stopLoss,
      contracts: n,
      spec,
    }),
  }
}

/** Was ein Trade an Kapital bindet — die Zeilen, die die Deckung aufbrauchen. */
export type GebundenZeile = {
  status: string
  investedAmount?: number | null
  /** NULL = kein Kontrakt-Trade. Entscheidet, ob die Zeile überhaupt zählt. */
  contracts?: number | null
}

/**
 * Der bereits gebundene EINSCHUSS eines Depots, in Kontowährung.
 *
 * Gezählt werden ausschließlich **Kontrakt-Trades** — nicht jede offene
 * Position. Das ist eine bewusste Grenze und keine Nachlässigkeit:
 *
 * `investedAmount` trägt bei einem Kontrakt-Trade den Einschuss, bei allen
 * anderen den Kapitaleinsatz. Das sind zwei verschiedene Dinge. Ein Depot mit
 * zehn Aktienpositionen à 300 € hätte sonst 3.000 € „gebundenen Einschuss",
 * obwohl kein einziger Einschuss existiert — und die Kontrakt-Deckung wäre um
 * genau diesen Betrag zu klein. Die Prüfung soll den Einschuss abbilden, den
 * ein Broker blockiert, nicht das gesamte eingesetzte Kapital.
 *
 * Geplante Trades zählen mit, weil der Plan VOR dem Einstieg feststeht: Wer
 * drei Setups vorbereitet hat, deren Einschüsse zusammen das Konto sprengen,
 * soll das beim dritten erfahren und nicht beim dritten Fill.
 */
export function gebundeneMargin(zeilen: readonly GebundenZeile[]): number {
  let summe = 0
  for (const z of zeilen) {
    if (z.status !== 'geplant' && z.status !== 'aktiv') continue
    // Kein Kontrakt-Trade → kein Einschuss, also nichts zu binden.
    if (z.contracts == null || !Number.isFinite(z.contracts) || z.contracts <= 0) continue
    const v = z.investedAmount
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) summe += v
  }
  return summe
}

/**
 * Der Einschuss eines Trades in Kontowährung — oder `null`, wenn er ohne
 * hinterlegten Umrechnungskurs nicht bestimmbar ist. Kein 1:1-Vergleich.
 */
export function einschussInKontowaehrung(args: {
  einschuss: number
  waehrung: string
  kontowaehrung: string
  rates: FxRates
}): number | null {
  const u = umrechnen(args.einschuss, args.waehrung, args.kontowaehrung, args.rates)
  return u.ok ? u.wert : null
}

/** Deckung aus den Rohgrößen eines Depots. Nur eine Weiterreichung — für einen Aufrufweg. */
export function deckungAus(args: {
  startCapital: number
  netCashflow: number
  realisiertePnl: number
  offeneTrades: readonly GebundenZeile[]
}): Deckung {
  return berechneDeckung({
    startCapital: args.startCapital,
    netCashflow: args.netCashflow,
    realisiertePnl: args.realisiertePnl,
    gebundeneMargin: gebundeneMargin(args.offeneTrades),
  })
}
