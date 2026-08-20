// Kontrakt-Spezifikationen: was ein Kontrakt eines Instruments wirtschaftlich ist.
//
// Warum das eine gepflegte Liste ist und kein Anbieterabruf: Yahoo liefert für
// Terminkontrakte KEINE verlässliche Tick-Größe, keinen Tick-Wert und schon gar
// keinen Einschuss. Ein daraus geratener Wert wäre genau das, was diese App
// nicht baut — eine plausible falsche Zahl. Lieber eine kurze, nachprüfbare
// Liste plus die Möglichkeit, am Instrument von Hand einzutragen.
//
// Die Handeingabe schlägt die Vorgabe (siehe `mergeContractSpec`): Die Börsen
// ändern Einschüsse mehrmals im Jahr, und was der eigene Broker verlangt, weiss
// nur der Nutzer.

/** Wie der Einschuss eines Kontrakts bestimmt wird. */
export type MarginModel = 'fest' | 'notional'

type SpecBasis = {
  /** Kontrakt-Wurzel, Großbuchstaben — der Schlüssel der Liste (`ES`, `MNQ`, `BTCPERP`). */
  root: string
  name: string
  /** Kleinste Kursbewegung. ES: 0,25 Punkte. */
  tickSize: number
  /** Was ein Tick je Kontrakt in der Kontraktwährung wert ist. ES: 12,50 $. */
  tickValue: number
  /** Basiswert-Einheiten je Kontrakt (der Multiplikator). ES: 50. */
  contractSize: number
  /** Währung, in der Tick-Wert und Einschuss notieren. */
  currency: string
}

export type ContractSpec = SpecBasis &
  (
    | {
        /** Fester Einschuss je Kontrakt — so rechnen die Terminbörsen. */
        marginModel: 'fest'
        initialMargin: number
        maintenanceMargin: number
      }
    | {
        /**
         * Einschuss aus dem Kontraktwert: Notional ÷ Hebel. So rechnen die
         * Krypto-Perpetuals — dort gibt es keinen festen Betrag je Kontrakt,
         * der Hebel bestimmt ihn.
         */
        marginModel: 'notional'
        /** Erhaltungssatz als ANTEIL des Kontraktwerts (0,005 = 0,5 %). */
        maintenanceRate: number
      }
  )

/**
 * Die gepflegten Vorgaben. Stand 20.08.2026; Einschüsse sind Richtwerte der
 * Börse (CME) und schwanken — der eigene Broker verlangt oft mehr. Wer es genau
 * braucht, trägt es am Instrument ein.
 */
export const CONTRACT_SPECS: Record<string, ContractSpec> = {
  // --- Aktienindex-Terminkontrakte (CME) ---
  ES: {
    root: 'ES',
    name: 'E-mini S&P 500',
    tickSize: 0.25,
    tickValue: 12.5,
    contractSize: 50,
    currency: 'USD',
    marginModel: 'fest',
    initialMargin: 13500,
    maintenanceMargin: 12300,
  },
  MES: {
    root: 'MES',
    name: 'Micro E-mini S&P 500',
    tickSize: 0.25,
    tickValue: 1.25,
    contractSize: 5,
    currency: 'USD',
    marginModel: 'fest',
    initialMargin: 1350,
    maintenanceMargin: 1230,
  },
  NQ: {
    root: 'NQ',
    name: 'E-mini Nasdaq 100',
    tickSize: 0.25,
    tickValue: 5,
    contractSize: 20,
    currency: 'USD',
    marginModel: 'fest',
    initialMargin: 26400,
    maintenanceMargin: 24000,
  },
  MNQ: {
    root: 'MNQ',
    name: 'Micro E-mini Nasdaq 100',
    tickSize: 0.25,
    tickValue: 0.5,
    contractSize: 2,
    currency: 'USD',
    marginModel: 'fest',
    initialMargin: 2640,
    maintenanceMargin: 2400,
  },
  YM: {
    root: 'YM',
    name: 'E-mini Dow',
    tickSize: 1,
    tickValue: 5,
    contractSize: 5,
    currency: 'USD',
    marginModel: 'fest',
    initialMargin: 11000,
    maintenanceMargin: 10000,
  },
  MYM: {
    root: 'MYM',
    name: 'Micro E-mini Dow',
    tickSize: 1,
    tickValue: 0.5,
    contractSize: 0.5,
    currency: 'USD',
    marginModel: 'fest',
    initialMargin: 1100,
    maintenanceMargin: 1000,
  },
  RTY: {
    root: 'RTY',
    name: 'E-mini Russell 2000',
    tickSize: 0.1,
    tickValue: 5,
    contractSize: 50,
    currency: 'USD',
    marginModel: 'fest',
    initialMargin: 8300,
    maintenanceMargin: 7550,
  },
  // --- Metalle (COMEX) ---
  GC: {
    root: 'GC',
    name: 'Gold',
    tickSize: 0.1,
    tickValue: 10,
    contractSize: 100,
    currency: 'USD',
    marginModel: 'fest',
    initialMargin: 12100,
    maintenanceMargin: 11000,
  },
  MGC: {
    root: 'MGC',
    name: 'Micro Gold',
    tickSize: 0.1,
    tickValue: 1,
    contractSize: 10,
    currency: 'USD',
    marginModel: 'fest',
    initialMargin: 1210,
    maintenanceMargin: 1100,
  },
  SI: {
    root: 'SI',
    name: 'Silber',
    tickSize: 0.005,
    tickValue: 25,
    contractSize: 5000,
    currency: 'USD',
    marginModel: 'fest',
    initialMargin: 17600,
    maintenanceMargin: 16000,
  },
  // --- Energie (NYMEX) ---
  CL: {
    root: 'CL',
    name: 'WTI Rohöl',
    tickSize: 0.01,
    tickValue: 10,
    contractSize: 1000,
    currency: 'USD',
    marginModel: 'fest',
    initialMargin: 6600,
    maintenanceMargin: 6000,
  },
  MCL: {
    root: 'MCL',
    name: 'Micro WTI Rohöl',
    tickSize: 0.01,
    tickValue: 1,
    contractSize: 100,
    currency: 'USD',
    marginModel: 'fest',
    initialMargin: 660,
    maintenanceMargin: 600,
  },
  // --- Krypto-Perpetuals ---
  //
  // Ein Kontrakt = eine Einheit des Basiswerts, der Einschuss hängt am Hebel.
  // Der Erhaltungssatz ist der Anteil des Kontraktwerts, unter den das Konto
  // nicht fallen darf — bei kleinen Positionen der niedrigste Satz der Börse.
  BTCPERP: {
    root: 'BTCPERP',
    name: 'Bitcoin Perpetual',
    tickSize: 0.1,
    tickValue: 0.1,
    contractSize: 1,
    currency: 'USD',
    marginModel: 'notional',
    maintenanceRate: 0.004,
  },
  ETHPERP: {
    root: 'ETHPERP',
    name: 'Ethereum Perpetual',
    tickSize: 0.01,
    tickValue: 0.01,
    contractSize: 1,
    currency: 'USD',
    marginModel: 'notional',
    maintenanceRate: 0.005,
  },
  SOLPERP: {
    root: 'SOLPERP',
    name: 'Solana Perpetual',
    tickSize: 0.01,
    tickValue: 0.01,
    contractSize: 1,
    currency: 'USD',
    marginModel: 'notional',
    maintenanceRate: 0.005,
  },
}

/**
 * Der Multiplikator: wie viel eine Bewegung um 1 Kurspunkt je Kontrakt wert ist.
 *
 * Das ist die Brücke zum bestehenden Rechenweg der App. `positionSize` bleibt
 * überall die Größe, mit der P&L, Settlement, Exkursion und Bot-Zwilling
 * rechnen — ein Kontrakt-Trade legt dort `Kontrakte × Multiplikator` ab. Damit
 * bleibt `(Ausstieg − Einstieg) × positionSize` weiterhin richtig, ohne dass
 * eine einzige bestehende Formel angefasst werden muss.
 */
export function contractMultiplier(spec: Pick<SpecBasis, 'tickSize' | 'tickValue'>): number {
  if (!spec.tickSize) return 0
  return spec.tickValue / spec.tickSize
}

const MONATSCODES = 'FGHJKMNQUVXZ'

/**
 * Die Kontrakt-Wurzel eines Tickers — oder `null`, wenn keiner erkennbar ist.
 *
 * Erkannt werden:
 *   - TradingViews fortlaufender Kontrakt: `ES1!`, `CL2!`
 *   - Yahoos Schreibweise: `ES=F`
 *   - Ein bestimmter Liefermonat: `ESZ5`, `ESZ2025`
 *   - Krypto-Perpetuals mit Kennung: `BTCUSDT.P`, `BTCUSDTPERP`, `BTCPERP`
 *
 * **Eine blanke Wurzel gilt nur bei `market === 'rohstoffe'.`** Ohne
 * Kontraktkennung sind viele Wurzeln gleichzeitig Aktienkürzel — `SI`, `GC` und
 * `CL` gibt es alle als Wertpapier. Dieselbe Bedingung verwendet der
 * Symbol-Resolver (`lib/market-data/resolve.ts`); wer hier großzügiger wäre,
 * würde eine Aktie stillschweigend mit dem 5.000-fachen Multiplikator rechnen.
 *
 * Ebenso bleibt blankes `ETHUSD` ein Spot-Wert: Ein bestehendes Instrument darf
 * nicht dadurch zum Kontrakt werden, dass diese Liste erscheint.
 */
export function kontraktWurzel(ticker: string, market?: string | null): string | null {
  const t = (ticker ?? '').trim().toUpperCase()
  if (!t) return null

  // Krypto-Perpetuals: Kennung ist Pflicht.
  const perp = /^([A-Z]{2,5})(?:USDT?|USD)?(?:\.P|PERP|-PERP)$/.exec(t)
  if (perp) {
    const root = `${perp[1]}PERP`
    return CONTRACT_SPECS[root] ? root : null
  }

  // Yahoo: `ES=F`
  const yahoo = /^([A-Z0-9]{1,4})=F$/.exec(t)
  if (yahoo) return CONTRACT_SPECS[yahoo[1]] ? yahoo[1] : null

  // TradingView: `ES1!`
  const tv = /^([A-Z0-9]{1,4}?)\d!$/.exec(t)
  if (tv) return CONTRACT_SPECS[tv[1]] ? tv[1] : null

  // Liefermonat: `ESZ5`, `ESZ2025`
  const monat = /^([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ])(\d{1,4})$/.exec(t)
  if (monat && MONATSCODES.includes(monat[2]) && CONTRACT_SPECS[monat[1]]) return monat[1]

  // Blanke Wurzel — nur als Rohstoff.
  if (market === 'rohstoffe' && CONTRACT_SPECS[t]) return t

  return null
}

/** Die Vorgabe zu einem Ticker, oder `null`. Nie den Rohticker weiterreichen. */
export function lookupContractSpec(ticker: string, market?: string | null): ContractSpec | null {
  const root = kontraktWurzel(ticker, market)
  return root ? CONTRACT_SPECS[root] : null
}

/** Was am Instrument von Hand eingetragen sein kann — jedes Feld einzeln optional. */
export type ContractSpecOverride = {
  tickSize?: number | null
  tickValue?: number | null
  contractSize?: number | null
  currency?: string | null
  marginModel?: string | null
  initialMargin?: number | null
  maintenanceMargin?: number | null
  maintenanceRate?: number | null
  /** Abschalter: „dieses Instrument handle ich NICHT in Kontrakten." */
  disabled?: boolean | null
}

function zahl(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

/**
 * Vorgabe und Handeingabe zu einer gültigen Spezifikation verschmelzen —
 * **feldweise**, Handeingabe gewinnt.
 *
 * Feldweise und nicht „alles oder nichts", weil sich in der Praxis genau EIN
 * Wert unterscheidet: der Einschuss des eigenen Brokers. Wer dafür Tick-Größe
 * und Kontraktgröße nachtippen müsste, tippt sich irgendwann einen Fehler ein.
 *
 * Unvollständig bleibt unvollständig: Fehlt Tick-Größe, Tick-Wert oder
 * Kontraktgröße, ist das Ergebnis `null` — das Instrument rechnet dann wie
 * bisher über Stückzahl und Kapitaleinsatz. Ein halb bekannter Kontrakt ist
 * kein Kontrakt, sondern ein stiller Falschwert.
 */
export function mergeContractSpec(
  vorgabe: ContractSpec | null,
  hand?: ContractSpecOverride | null,
): ContractSpec | null {
  if (hand?.disabled) return null

  const tickSize = zahl(hand?.tickSize) ?? vorgabe?.tickSize ?? null
  const tickValue = zahl(hand?.tickValue) ?? vorgabe?.tickValue ?? null
  const contractSize = zahl(hand?.contractSize) ?? vorgabe?.contractSize ?? null
  const currency = hand?.currency?.trim().toUpperCase() || vorgabe?.currency || null
  if (tickSize == null || tickValue == null || contractSize == null || !currency) return null

  const basis: SpecBasis = {
    root: vorgabe?.root ?? 'EIGEN',
    name: vorgabe?.name ?? 'Eigene Spezifikation',
    tickSize,
    tickValue,
    contractSize,
    currency,
  }

  const modell: MarginModel =
    hand?.marginModel === 'fest' || hand?.marginModel === 'notional'
      ? hand.marginModel
      : (vorgabe?.marginModel ?? 'fest')

  if (modell === 'notional') {
    const rate =
      zahl(hand?.maintenanceRate) ??
      (vorgabe?.marginModel === 'notional' ? vorgabe.maintenanceRate : null)
    if (rate == null) return null
    return { ...basis, marginModel: 'notional', maintenanceRate: rate }
  }

  const initial =
    zahl(hand?.initialMargin) ??
    (vorgabe?.marginModel === 'fest' ? vorgabe.initialMargin : null)
  if (initial == null) return null
  const halten =
    zahl(hand?.maintenanceMargin) ??
    (vorgabe?.marginModel === 'fest' ? vorgabe.maintenanceMargin : null) ??
    initial
  return { ...basis, marginModel: 'fest', initialMargin: initial, maintenanceMargin: halten }
}

/**
 * Die gültige Spezifikation eines Instruments: Vorgabe per Wurzel, überschrieben
 * von dem, was am Instrument steht. Der EINE Weg zu einer Spezifikation — nie
 * `CONTRACT_SPECS` direkt auslesen, sonst geht die Handeingabe verloren.
 */
export function resolveContractSpec(args: {
  ticker: string
  market?: string | null
  hand?: ContractSpecOverride | null
}): ContractSpec | null {
  return mergeContractSpec(lookupContractSpec(args.ticker, args.market), args.hand)
}
