/**
 * Der Hintergrund der gesamten App: leuchtende Kerzen auf tiefem Verlauf.
 *
 * Bewusst SVG statt einer Bilddatei — skaliert verlustfrei auf jedes Format,
 * folgt den Farbtokens aus `app/globals.css` und kostet keinen zusätzlichen
 * Ladevorgang. Server-Komponente, kein JavaScript.
 *
 * Lesbarkeit geht vor Effekt: Die Kerzen sitzen in den Randzonen links und
 * rechts der Inhaltsspalte (`max-w-6xl`), und darüber liegt ein Scrim, der zur
 * Mitte hin deutlich dichter wird. Auf schmalen Viewports, wo es keine Ränder
 * gibt, wird die Ebene per CSS stark zurückgenommen.
 */

/** Eine Kerze. `lit` = die hellen, leuchtenden; sonst dunkler Körper mit Kante. */
function Candle({
  x,
  bodyTop,
  bodyHeight,
  wickTop,
  wickBottom,
  lit,
  width = 52,
}: {
  x: number
  bodyTop: number
  bodyHeight: number
  wickTop: number
  wickBottom: number
  lit: boolean
  width?: number
}) {
  return (
    <g className={lit ? 'candle-lit' : 'candle-dim'}>
      <line
        x1={x + width / 2}
        y1={wickTop}
        x2={x + width / 2}
        y2={wickBottom}
        stroke="currentColor"
        strokeWidth={lit ? 5 : 4}
        strokeLinecap="round"
      />
      <rect
        x={x}
        y={bodyTop}
        width={width}
        height={bodyHeight}
        rx={3}
        fill={lit ? 'currentColor' : 'var(--card)'}
        stroke="currentColor"
        strokeWidth={lit ? 0 : 2}
      />
    </g>
  )
}

export function AppBackdrop() {
  return (
    <div className="app-backdrop" aria-hidden="true">
      <svg
        className="app-backdrop-art"
        viewBox="0 0 1920 1080"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          {/* Grundverlauf: heller Kern oben links, nach unten rechts auslaufend. */}
          <radialGradient id="bd-glow" cx="8%" cy="0%" r="95%">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.42" />
            <stop offset="45%" stopColor="var(--primary)" stopOpacity="0.10" />
            <stop offset="100%" stopColor="var(--background)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="bd-sweep" x1="100%" y1="100%" x2="20%" y2="30%">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
          </linearGradient>
          <pattern id="bd-grid" width="120" height="120" patternUnits="userSpaceOnUse">
            <path
              d="M120 0 H0 V120"
              fill="none"
              stroke="var(--border)"
              strokeWidth="1"
              strokeOpacity="0.5"
            />
          </pattern>
        </defs>

        <rect width="1920" height="1080" fill="var(--background)" />
        <rect width="1920" height="1080" fill="url(#bd-grid)" />
        <rect width="1920" height="1080" fill="url(#bd-glow)" />

        {/* Angedeutete Kurve unten rechts, wie im Vorbild. */}
        <path
          d="M1180 1080 L1330 890 L1450 940 L1560 790 L1680 830 L1920 640 L1920 1080 Z"
          fill="url(#bd-sweep)"
        />

        {/* Die Kerzen bleiben in den Randzonen neben der Inhaltsspalte
            (max-w-6xl): links etwa bis x=250, rechts ab x=1670. */}
        <g className="candle-group">
          <Candle x={54} bodyTop={648} bodyHeight={150} wickTop={606} wickBottom={846} lit={false} width={38} />
          <Candle x={130} bodyTop={556} bodyHeight={214} wickTop={512} wickBottom={824} lit width={38} />
        </g>

        {/* Rechte Randzone — die aufsteigende Staffel wie im Vorbild. */}
        <g className="candle-group">
          <Candle x={1676} bodyTop={604} bodyHeight={168} wickTop={558} wickBottom={820} lit={false} width={38} />
          <Candle x={1752} bodyTop={472} bodyHeight={228} wickTop={424} wickBottom={758} lit width={38} />
          <Candle x={1828} bodyTop={384} bodyHeight={196} wickTop={330} wickBottom={648} lit={false} width={38} />
          <Candle x={1878} bodyTop={268} bodyHeight={252} wickTop={214} wickBottom={586} lit width={38} />
        </g>
      </svg>
      <div className="app-backdrop-scrim" />
    </div>
  )
}
