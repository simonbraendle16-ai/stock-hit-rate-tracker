import React, { useMemo } from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion'
import { COLORS, LAYOUT, formatPrice, indexToX, priceToY } from '../theme'
import {
  CANDLE_COUNT,
  SETUPS,
  buildSeries,
  frameForCandle,
  resolutionIndex,
  visibleCandlesAt,
} from './series'
import { Candles } from './Candles'
import { PlanLevels } from './PlanLevels'
import { MONO, usePlexMono } from './use-plex-mono'

/** Zeichnungsfenster der beiden Pläne — der Plan steht immer vor dem Kurs. */
const PLAN_TIMING = [
  { revealStart: 60, revealEnd: 86, fadeStart: 196, fadeEnd: 220 },
  { revealStart: 214, revealEnd: 242, fadeStart: 400, fadeEnd: 420 },
] as const

const GRID_PRICES = [94, 98, 102, 106, 110, 114, 118, 122]

export const ZoneRun: React.FC = () => {
  usePlexMono()
  const frame = useCurrentFrame()
  const candles = useMemo(() => buildSeries(), [])

  const visible = visibleCandlesAt(frame)

  // Die Kamera fährt erst mit, wenn der Chart die Bildbreite füllt — dadurch
  // baut sich die Szene zuerst auf und beginnt dann ruhig zu wandern.
  const cameraX = Math.max(0, indexToX(visible) - LAYOUT.width * LAYOUT.anchor)

  // Loop-Naht: Frame 419 verschwindet ins Navy, Frame 0 kommt daraus hervor.
  const loopOpacity = interpolate(frame, [0, 14, 392, 419], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.navy }}>
      <svg
        width={LAYOUT.width}
        height={LAYOUT.height}
        viewBox={`0 0 ${LAYOUT.width} ${LAYOUT.height}`}
      >
        <defs>
          <radialGradient id="vignette" cx="52%" cy="48%" r="76%">
            <stop offset="55%" stopColor={COLORS.navy} stopOpacity={0} />
            <stop offset="100%" stopColor={COLORS.navy} stopOpacity={0.75} />
          </radialGradient>
          <linearGradient id="axis-fade" x1="0" x2="1">
            <stop offset="0%" stopColor={COLORS.navy} stopOpacity={0} />
            <stop offset="45%" stopColor={COLORS.navy} stopOpacity={0.92} />
            <stop offset="100%" stopColor={COLORS.navy} stopOpacity={0.98} />
          </linearGradient>
        </defs>

        <g opacity={loopOpacity}>
          <PriceGrid frame={frame} />

          <g transform={`translate(${-cameraX} 0)`}>
            <TimeGrid frame={frame} />
            <Candles candles={candles} visible={visible} />
            {SETUPS.map((setup, i) => {
              const index = resolutionIndex(candles, setup)
              return (
                <PlanLevels
                  key={setup.entryIndex}
                  id={`setup-${i}`}
                  setup={setup}
                  resolutionIndex={index}
                  resolutionFrame={index === null ? null : frameForCandle(index + 1)}
                  {...PLAN_TIMING[i]}
                />
              )
            })}
          </g>

          <PriceAxis frame={frame} />
          <rect
            x={0}
            y={0}
            width={LAYOUT.width}
            height={LAYOUT.height}
            fill="url(#vignette)"
          />
        </g>
      </svg>
    </AbsoluteFill>
  )
}

/** Waagerechte Haarlinien — sie scrollen nicht, der Preismaßstab ist fest. */
function PriceGrid({ frame }: { frame: number }) {
  const opacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return (
    <g opacity={opacity}>
      {GRID_PRICES.map((price) => {
        const y = priceToY(price)
        // Die Linien fahren von links ein, statt einfach da zu sein.
        const width = interpolate(frame, [0, 24], [0, LAYOUT.width], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
        return (
          <line
            key={price}
            x1={0}
            x2={width}
            y1={y}
            y2={y}
            stroke={COLORS.hairline}
            strokeWidth={1}
            strokeOpacity={0.55}
          />
        )
      })}
    </g>
  )
}

/** Senkrechte Hilfslinien alle acht Kerzen — sie wandern mit der Kamera. */
function TimeGrid({ frame }: { frame: number }) {
  const opacity = interpolate(frame, [8, 28], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const lines: number[] = []
  for (let i = 0; i <= CANDLE_COUNT + 24; i += 8) lines.push(i)

  return (
    <g opacity={opacity}>
      {lines.map((i) => (
        <line
          key={i}
          x1={indexToX(i)}
          x2={indexToX(i)}
          y1={LAYOUT.padTop - 40}
          y2={LAYOUT.height - LAYOUT.padBottom + 40}
          stroke={COLORS.hairline}
          strokeWidth={1}
          strokeOpacity={0.22}
        />
      ))}
    </g>
  )
}

/** Preisskala rechts, über einem Navy-Verlauf, damit Kerzen nicht hineinlaufen. */
function PriceAxis({ frame }: { frame: number }) {
  const opacity = interpolate(frame, [10, 30], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return (
    <g opacity={opacity}>
      <rect
        x={LAYOUT.width - 230}
        y={0}
        width={230}
        height={LAYOUT.height}
        fill="url(#axis-fade)"
      />
      {GRID_PRICES.map((price) => (
        <text
          key={price}
          x={LAYOUT.width - 44}
          y={priceToY(price) + 7}
          textAnchor="end"
          fill={COLORS.muted}
          style={{ fontFamily: MONO, fontSize: 20, letterSpacing: 1.2 }}
          opacity={0.75}
        >
          {formatPrice(price)}
        </text>
      ))}
    </g>
  )
}
