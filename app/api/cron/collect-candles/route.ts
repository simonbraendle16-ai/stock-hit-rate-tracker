import { runCandleCollect } from '@/lib/market-data/candle-collect'
import { NextRequest, NextResponse } from 'next/server'

/** Server-only market-data maintenance. Independent of app activity.
 * Scheduling is prepared separately and remains disabled in Phase 2. */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      {
        error:
          'CRON_SECRET ist nicht gesetzt. Ohne Geheimnis läuft das Kerzen-Sammeln nicht — ' +
          'bitte in den Projekt-Einstellungen (und in .env.local) hinterlegen.',
      },
      { status: 500 },
    )
  }

  const header = req.headers.get('authorization')
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }

  try {
    const report = await runCandleCollect({ trigger: 'cron' })

    // Partial failures remain visible to the scheduler; stored history stays available.
    return NextResponse.json({
    ok: report.error === null && report.seriesFailed === 0,
    ran: report.ran,
    skipped: report.skipped,
    seriesDue: report.seriesDue,
    seriesFetched: report.seriesFetched,
    seriesFailed: report.seriesFailed,
    candlesAdded: report.candlesAdded,
    candlesPruned: report.candlesPruned,
    error: report.error,
  }, { status: report.error || report.seriesFailed ? 503 : 200 })
  } catch {
    return NextResponse.json({ ok: false, ran: false, error: 'Kursdatenpflege fehlgeschlagen.' }, { status: 503 })
  }
}
