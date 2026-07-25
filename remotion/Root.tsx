import React from 'react'
import { Composition } from 'remotion'
import { ZoneRun } from './zone-run/ZoneRun'

/**
 * 14 s bei 30 fps. Die Länge ist nicht beliebig: sie ergibt sich aus dem
 * Fahrplan in `zone-run/candles.ts` (zwei Setups mit Aufbau, Plan-Zeichnung
 * und Auflösung) und aus der Loop-Naht in den letzten 28 Frames.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="ZoneRun"
      component={ZoneRun}
      durationInFrames={420}
      fps={30}
      width={1920}
      height={1080}
    />
  )
}
