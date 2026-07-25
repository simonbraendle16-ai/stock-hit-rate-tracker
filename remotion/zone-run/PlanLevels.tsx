import React from 'react'
import { interpolate, useCurrentFrame } from 'remotion'
import { COLORS, LAYOUT, formatPrice, indexToX, priceToY } from '../theme'
import type { Setup } from './series'
import { MONO } from './use-plex-mono'

/** Wie weit der Plan über den Einstieg hinaus nach rechts reicht. */
const PLAN_LENGTH = 46

type Props = {
  setup: Setup
  id: string
  /** Frame, ab dem der Plan gezeichnet wird. */
  revealStart: number
  /** Frame, ab dem der Plan vollständig steht. */
  revealEnd: number
  fadeStart: number
  fadeEnd: number
  /** Kerzen-Index, an dem sich das Setup auflöst (aus den echten Daten). */
  resolutionIndex: number | null
  /** Frame, ab dem das Ergebnis-Label erscheint. */
  resolutionFrame: number | null
}

/**
 * Entry, Stop und Zielzone eines Setups — die Ebene, die in dieser Graphik
 * als Einzige Farbe tragen darf. Der Plan wird immer VOR dem Kurs gezeichnet:
 * Risiko ist vor dem Einstieg definiert.
 */
export function PlanLevels({
  setup,
  id,
  revealStart,
  revealEnd,
  fadeStart,
  fadeEnd,
  resolutionIndex,
  resolutionFrame,
}: Props) {
  const frame = useCurrentFrame()

  const opacity = interpolate(
    frame,
    [revealStart, revealStart + 6, fadeStart, fadeEnd],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  )
  if (opacity <= 0.001) return null

  const entryX = indexToX(setup.entryIndex)
  const planRight = indexToX(setup.entryIndex + PLAN_LENGTH)
  const sweep = interpolate(frame, [revealStart, revealEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const zoneTop = priceToY(setup.zone[1])
  const zoneBottom = priceToY(setup.zone[0])
  const yEntry = priceToY(setup.entry)
  const yStop = priceToY(setup.stop)

  // Beim Erreichen der Zielzone wird deren Kante kurz kräftiger — über
  // Deckkraft und Strichstärke, ausdrücklich nicht über Glow.
  const hit =
    resolutionFrame !== null && setup.outcome === 'ziel'
      ? interpolate(frame, [resolutionFrame, resolutionFrame + 12], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 0

  return (
    <g opacity={opacity}>
      <defs>
        <clipPath id={`sweep-${id}`}>
          <rect
            x={entryX - 6}
            y={0}
            width={(planRight - entryX + 12) * sweep}
            height={LAYOUT.height}
          />
        </clipPath>
      </defs>

      <g clipPath={`url(#sweep-${id})`}>
        {/* Zielzone */}
        <rect
          x={entryX}
          y={zoneTop}
          width={planRight - entryX}
          height={zoneBottom - zoneTop}
          fill={COLORS.green}
          fillOpacity={0.08 + hit * 0.05}
        />
        <rect
          x={entryX}
          y={zoneTop}
          width={planRight - entryX}
          height={zoneBottom - zoneTop}
          fill="none"
          stroke={COLORS.green}
          strokeWidth={1 + hit}
          strokeOpacity={0.5 + hit * 0.45}
        />

        {/* Einstieg */}
        <line
          x1={entryX}
          x2={planRight}
          y1={yEntry}
          y2={yEntry}
          stroke={COLORS.cream}
          strokeWidth={1.5}
          strokeOpacity={0.65}
          strokeDasharray="12 10"
        />
        <circle
          cx={entryX}
          cy={yEntry}
          r={7}
          fill={COLORS.navy}
          stroke={COLORS.cream}
          strokeWidth={2}
          strokeOpacity={0.8}
        />

        {/* Stop */}
        <line
          x1={entryX}
          x2={planRight}
          y1={yStop}
          y2={yStop}
          stroke={COLORS.red}
          strokeWidth={2}
          strokeOpacity={0.7}
        />

        <Tag
          x={entryX + 18}
          y={zoneTop - 30}
          color={COLORS.green}
          text={`ZIELZONE  ${formatPrice(setup.zone[0])} – ${formatPrice(setup.zone[1])}`}
        />
        <Tag
          x={entryX + 18}
          y={yEntry - 30}
          color={COLORS.cream}
          text={`EINSTIEG  ${formatPrice(setup.entry)}`}
        />
        <Tag
          x={entryX + 18}
          y={yStop + 12}
          color={COLORS.red}
          text={`STOP  ${formatPrice(setup.stop)}`}
        />
      </g>

      {resolutionIndex !== null && resolutionFrame !== null ? (
        <Resolution
          setup={setup}
          index={resolutionIndex}
          startFrame={resolutionFrame}
          frame={frame}
        />
      ) : null}
    </g>
  )
}

const TAG_FONT = 21
const TAG_TRACK = 1.6
const TAG_PAD = 13
const TAG_HEIGHT = 36

/**
 * Kurs-Plakette wie im Terminal: der Text liegt auf einer eigenen Navy-Fläche
 * mit farbiger Haarlinie. Ohne sie laufen die Labels in die Kerzen hinein —
 * und der Einstiegskurs liegt naturgemäß genau dort, wo der Kurs handelt.
 */
function Tag({
  x,
  y,
  color,
  text,
  strong = false,
}: {
  x: number
  y: number
  color: string
  text: string
  strong?: boolean
}) {
  // IBM Plex Mono hat eine feste Laufweite — die Breite lässt sich rechnen.
  const width = text.length * (TAG_FONT * 0.6 + TAG_TRACK) + TAG_PAD * 2
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={TAG_HEIGHT}
        rx={3}
        fill={COLORS.navy}
        fillOpacity={0.9}
        stroke={color}
        strokeOpacity={strong ? 0.75 : 0.4}
        strokeWidth={1}
      />
      <text
        x={x + TAG_PAD}
        y={y + TAG_HEIGHT / 2 + 7}
        fill={color}
        style={{
          fontFamily: MONO,
          fontSize: TAG_FONT,
          fontWeight: strong ? 600 : 500,
          letterSpacing: TAG_TRACK,
        }}
      >
        {text}
      </text>
    </g>
  )
}

/** Das Ergebnis-Label an genau der Kerze, die das Setup auflöst. */
function Resolution({
  setup,
  index,
  startFrame,
  frame,
}: {
  setup: Setup
  index: number
  startFrame: number
  frame: number
}) {
  const appear = interpolate(frame, [startFrame, startFrame + 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  if (appear <= 0.001) return null

  const reachedTarget = setup.outcome === 'ziel'
  const color = reachedTarget ? COLORS.green : COLORS.red
  const x = indexToX(index) + 34
  const y = reachedTarget
    ? priceToY(setup.zone[1]) - 84
    : priceToY(setup.stop) + 54
  const rise = (1 - appear) * 10

  return (
    <g opacity={appear} transform={`translate(0 ${rise})`}>
      <circle cx={x - 16} cy={y + TAG_HEIGHT / 2} r={5} fill={color} />
      <Tag x={x} y={y} color={color} text={setup.label.toUpperCase()} strong />
    </g>
  )
}
