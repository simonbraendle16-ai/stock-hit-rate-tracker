import React from 'react'
import { COLORS, LAYOUT, indexToX, priceToY } from '../theme'
import type { Candle } from './series'

/**
 * Die Kerzen bewusst farbneutral: gefülltes Creme für steigende, hohl für
 * fallende Kerzen. Farbe trägt in dieser Graphik ausschließlich der Plan
 * (grüne Zielzone, rote Stop-Linie) — der Markt selbst bleibt unbewertet.
 * Das ist die Douglas-Haltung der App, in Bildsprache übersetzt.
 */
function CandleShape({ candle, grow }: { candle: Candle; grow: number }) {
  const rising = candle.close >= candle.open

  // Die jüngste Kerze wächst aus ihrem Eröffnungskurs heraus, statt zu poppen.
  const close = candle.open + (candle.close - candle.open) * grow
  const bodyTop = Math.max(candle.open, close)
  const bodyBottom = Math.min(candle.open, close)
  const upperWick = candle.high - Math.max(candle.open, candle.close)
  const lowerWick = Math.min(candle.open, candle.close) - candle.low
  const high = bodyTop + upperWick * grow
  const low = bodyBottom - lowerWick * grow

  const x = indexToX(candle.index)
  const yHigh = priceToY(high)
  const yLow = priceToY(low)
  const yTop = priceToY(bodyTop)
  const yBottom = priceToY(bodyBottom)
  const height = Math.max(1.5, yBottom - yTop)

  return (
    <g opacity={0.86}>
      <line
        x1={x}
        x2={x}
        y1={yHigh}
        y2={yLow}
        stroke={COLORS.cream}
        strokeWidth={1.5}
        opacity={rising ? 0.8 : 0.6}
      />
      <rect
        x={x - LAYOUT.candleWidth / 2}
        y={yTop}
        width={LAYOUT.candleWidth}
        height={height}
        fill={rising ? COLORS.cream : COLORS.navy}
        stroke={COLORS.cream}
        strokeWidth={1.5}
        opacity={rising ? 0.9 : 0.72}
      />
    </g>
  )
}

export function Candles({
  candles,
  visible,
}: {
  candles: Candle[]
  visible: number
}) {
  const complete = Math.floor(visible)
  const grow = visible - complete

  return (
    <g>
      {candles.slice(0, complete).map((candle) => (
        <CandleShape key={candle.index} candle={candle} grow={1} />
      ))}
      {grow > 0.02 && candles[complete] ? (
        <CandleShape candle={candles[complete]} grow={grow} />
      ) : null}
    </g>
  )
}
