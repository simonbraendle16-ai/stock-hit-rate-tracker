// Der gemeinsame Kerzen-Ladeweg der Auswertungen auf /tracking.
//
// Bot-Zwilling (Etappe 5) und MAE/MFE (Etappe 7c) beantworten zwei verschiedene
// Fragen, brauchen dafür aber dieselben Reihen. Diese Datei hält den Loader, der
// jede (Symbol, Markt, Auflösung) genau EINMAL je Aufruf anfragt — damit die
// zweite Auswertung das Minutenlimit des Anbieters nicht ein zweites Mal belastet.
//
// Kein `'use server'`: das hier sind normale Server-Funktionen, keine Actions.

import { getCachedCandles } from './cached'
import { MarketDataError, type Candle, type Interval, type Market } from './types'
import { BOT_INTERVALS, type BotSkipReason } from '@/lib/bot-twin'
import { computeExcursion, type ExcursionInput, type ExcursionRun } from '@/lib/excursion'

/** Was beim Laden schiefgehen kann — eine echte Teilmenge der Skip-Gründe. */
export type LoadErrorReason = Extract<
  BotSkipReason,
  'nicht_abgerufen' | 'unbekanntes_symbol' | 'nicht_unterstuetzt' | 'kursdaten_fehler'
>

export type LoadedCandles = Candle[] | { error: LoadErrorReason }
export type CandleLoader = (
  symbol: string,
  market: Market,
  interval: Interval,
) => Promise<LoadedCandles>

/**
 * Welcher Anbieter hinter einem Markt steht (siehe `lib/market-data/index.ts`).
 *
 * Wichtig für das Minutenlimit: Binance und Twelve Data haben nichts
 * miteinander zu tun. Ein erschöpftes Twelve-Data-Kontingent darf die
 * Krypto-Trades nicht mit blockieren.
 */
function providerKey(market: Market): string {
  return market === 'krypto' ? 'binance' : 'twelvedata'
}

/**
 * Lädt Kerzen genau einmal je (Symbol, Markt, Auflösung) und merkt sich das
 * Ergebnis für diesen Aufruf.
 *
 * Twelve Data Free erlaubt ~8 Anfragen pro Minute. Statt blind zu deckeln wird
 * bis zum ersten echten Limit-Fehler geladen; danach gelten die noch nicht
 * geladenen Symbole **dieses Anbieters** als „diesmal nicht abgerufen". Beim
 * nächsten Aufruf sind die bereits geholten Reihen im Kerzen-Cache und die
 * übrigen kommen dran — die Auswertung füllt sich von selbst auf, ohne je zu
 * crashen.
 */
export function createCandleLoader(): CandleLoader {
  const cache = new Map<string, LoadedCandles>()
  const limited = new Set<string>()

  return async function load(symbol, market, interval) {
    const key = `${symbol}|${market}|${interval}`
    const hit = cache.get(key)
    if (hit) return hit
    const provider = providerKey(market)
    if (limited.has(provider)) return { error: 'nicht_abgerufen' }

    try {
      const candles = await getCachedCandles(symbol, market, interval)
      cache.set(key, candles)
      return candles
    } catch (err) {
      const code = err instanceof MarketDataError ? err.code : 'upstream'
      if (code === 'rate_limit') {
        // Nicht merken: beim nächsten Aufruf soll es dasselbe Symbol erneut
        // versuchen dürfen, sobald das Minutenfenster weiter ist.
        limited.add(provider)
        return { error: 'nicht_abgerufen' }
      }
      const failed: LoadedCandles = {
        error:
          code === 'unknown_symbol'
            ? 'unbekanntes_symbol'
            : code === 'unsupported'
              ? 'nicht_unterstuetzt'
              : 'kursdaten_fehler',
      }
      cache.set(key, failed)
      return failed
    }
  }
}

/**
 * MAE/MFE eines Trades über die passende Auflösung.
 *
 * Beginnt bei der nach Haltedauer bevorzugten Auflösung und geht bei zu kurzer
 * Historie eine Stufe gröber (`BOT_INTERVALS`) — dieselbe Kette wie beim
 * Bot-Zwilling, damit beide Auswertungen dieselben Reihen benutzen und der
 * Loader jede nur einmal holt.
 *
 * Eine **grobe** Messung wird nicht verworfen: sie ist die ehrlichste Zahl, die
 * die Daten hergeben, und wird als solche gekennzeichnet (`run.coarse`).
 */
export async function resolveExcursion(
  input: ExcursionInput,
  ticker: string,
  market: Market,
  preferred: Interval,
  load: CandleLoader,
): Promise<{ run: ExcursionRun; resolution: Interval | null }> {
  const start = Math.max(0, BOT_INTERVALS.indexOf(preferred))
  const chain = BOT_INTERVALS.slice(start)

  let fallback: { run: ExcursionRun; resolution: Interval | null } = {
    run: { measured: false, reason: 'keine_kerzen' },
    resolution: null,
  }

  for (const interval of chain) {
    const loaded = await load(ticker, market, interval)
    if (!Array.isArray(loaded)) {
      // Ein Abrufproblem ist kein Grund, gröber zu werden — es beträfe dasselbe
      // Symbol erneut. Gemerkt und weiter, falls die gröbere Reihe schon im
      // Cache liegt.
      fallback = { run: { measured: false, reason: loaded.error }, resolution: null }
      continue
    }

    const run = computeExcursion(input, loaded)
    if (run.measured) return { run, resolution: interval }

    // Nur eine zu kurze Historie rechtfertigt den Wechsel auf gröbere Kerzen —
    // ein fehlendes Risiko oder ein fehlender Zeitpunkt bleibt in jeder Auflösung.
    if (run.reason !== 'historie_zu_kurz' && run.reason !== 'keine_kerzen') {
      return { run, resolution: interval }
    }
    fallback = { run, resolution: interval }
  }

  return fallback
}
