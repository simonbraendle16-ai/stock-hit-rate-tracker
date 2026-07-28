import { getCachedCandles } from '@/lib/market-data/cached'
import { createSymbolResolver } from '@/lib/market-data/lookup'
import type { Candle } from '@/lib/market-data/types'
import type { Market } from '@/lib/market-data'
import type { TradeRow } from '@/lib/trade-stats'
import { Clapperboard } from 'lucide-react'
import { ChartHeader } from '@/components/chart-frame'

const W = 720
const H = 260
// Rechts genug Platz für die längste Beschriftung („Einstieg 1.234,56"),
// sonst schneidet die viewBox sie ab.
const PAD = { top: 18, right: 118, bottom: 22, left: 14 }

/**
 * „Dein Plan gegen den Markt" — der Trade als gezeichnete Szene.
 *
 * Erst wird der Plan gebaut (Einstieg, Stop, Zielzone), dann läuft der echte
 * Kursverlauf hinein. Dieselbe Erzählung wie die Motion-Graphik auf der
 * Anmeldeseite, nur nicht erfunden, sondern aus dem eigenen Journal.
 *
 * Handgebautes SVG, kein `@remotion/player`: Das Bundle bleibt unverändert, die
 * Bewegung läuft über CSS und der Endzustand steht auch ohne sie korrekt da.
 *
 * **Ohne Kursdaten** (alter Trade, Anbietergrenze, unbekanntes Symbol) wird der
 * Plan allein gezeichnet. Bewusst kein erfundener Verlauf — das würde Kursdaten
 * vortäuschen, die es nicht gibt.
 */
export async function TradeReplay({ t }: { t: TradeRow }) {
  let candles: Candle[] = []
  let fehler: string | null = null

  try {
    // Über das verknüpfte Instrument auflösen, nicht über den Ticker des
    // Trades: Der Solana-Trade heißt `SOL`, beim Anbieter heißt er `SOL-USD`.
    // Ungefragt weitergereicht blieb der Chart hier leer.
    const resolve = await createSymbolResolver(t.userId)
    const symbol = resolve(t.ticker, t.stockId)
    const data = await getCachedCandles(symbol, (t.market ?? 'aktien') as Market, '1day')
    candles = Array.isArray(data) ? data.slice(-90) : []
  } catch (err) {
    fehler = err instanceof Error ? err.message : 'Kursdaten nicht verfügbar'
  }

  const entry = t.entryPrice
  const stop = t.stopLoss
  const target = t.takeProfit ?? null

  // Preisspanne aus Plan UND Kursen, damit nie etwas aus dem Bild läuft.
  const werte = [entry, stop, ...(target != null ? [target] : [])]
  for (const c of candles) werte.push(c.high, c.low)
  const rohMin = Math.min(...werte)
  const rohMax = Math.max(...werte)
  const spanne = rohMax - rohMin || Math.abs(entry) * 0.1 || 1
  const min = rohMin - spanne * 0.12
  const max = rohMax + spanne * 0.12

  const y = (p: number) =>
    PAD.top + ((max - p) / (max - min)) * (H - PAD.top - PAD.bottom)
  const x = (i: number, n: number) =>
    PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.left - PAD.right))

  const pfad = candles.length
    ? candles.map((c, i) => `${i === 0 ? 'M' : 'L'}${x(i, candles.length).toFixed(1)},${y(c.close).toFixed(1)}`).join(' ')
    : null

  const zoneOben = target != null ? Math.min(y(target), y(entry)) : null
  const zoneHoehe = target != null ? Math.abs(y(target) - y(entry)) : null

  return (
    <div className="panel sheen p-4 sm:p-5">
      <ChartHeader
        icon={Clapperboard}
        title="Dein Plan gegen den Markt"
        subtitle={
          pfad
            ? 'Der Plan wird gezeichnet, dann läuft der Kurs hinein'
            : 'Der Plan — für dieses Instrument liegen keine Kursdaten vor'
        }
      />

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Trade-Verlauf">
        {/* Zielzone: Einstieg bis Ziel — dieselbe Optik wie im Chart-Cockpit. */}
        {zoneOben != null && zoneHoehe != null && (
          <rect
            className="replay-plan"
            x={PAD.left}
            y={zoneOben}
            width={W - PAD.left - PAD.right}
            height={Math.max(zoneHoehe, 1)}
            fill="var(--positive)"
            fillOpacity="0.09"
            stroke="var(--positive)"
            strokeOpacity="0.4"
            strokeWidth="1"
          />
        )}

        <Level y={y(entry)} label={`Einstieg ${fmt(entry)}`} color="var(--foreground)" dashed />
        <Level y={y(stop)} label={`Stop ${fmt(stop)}`} color="var(--destructive)" />
        {target != null && (
          <Level y={y(target)} label={`Ziel ${fmt(target)}`} color="var(--positive)" />
        )}

        {/* Der Kurs läuft zuletzt ein — der Plan stand vorher. */}
        {pfad && (
          <path
            className="replay-price"
            d={pfad}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ '--dash': '3000' } as React.CSSProperties}
          />
        )}
      </svg>

      <p className="note mt-2">
        {pfad
          ? `${candles.length} Tageskerzen · Der Plan stand vor dem Kurs.`
          : (fehler ?? 'Keine Kursdaten für dieses Symbol.')}
      </p>
    </div>
  )
}

function fmt(v: number) {
  return v.toLocaleString('de-DE', { maximumFractionDigits: 2 })
}

function Level({
  y,
  label,
  color,
  dashed,
}: {
  y: number
  label: string
  color: string
  dashed?: boolean
}) {
  return (
    <g className="replay-plan">
      <line
        x1={PAD.left}
        y1={y}
        x2={W - PAD.right}
        y2={y}
        stroke={color}
        strokeWidth="1.25"
        strokeOpacity="0.75"
        strokeDasharray={dashed ? '6 5' : undefined}
      />
      <text
        x={W - PAD.right + 6}
        y={y + 3.5}
        fill={color}
        fillOpacity="0.9"
        className="font-mono"
        fontSize="10"
      >
        {label}
      </text>
    </g>
  )
}
