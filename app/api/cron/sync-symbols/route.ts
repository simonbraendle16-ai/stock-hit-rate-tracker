import { runSymbolSync } from '@/lib/market-data/sync'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Der Hintergrundlauf, der die Watchlist am Leben hält.
 *
 * Aufgerufen von Vercel Cron (Zeitplan in `vercel.json`). Vercel schickt dabei
 * den Header `Authorization: Bearer <CRON_SECRET>`; ohne gültiges Geheimnis
 * antwortet die Route mit 401. Das ist kein Selbstzweck: Die Route stößt
 * Abfragen bei einem externen Anbieter an, und die soll nicht jeder auslösen
 * können, der die URL kennt.
 *
 * Von Hand anstoßen (PowerShell):
 *   curl -H "Authorization: Bearer $env:CRON_SECRET" https://<deine-app>/api/cron/sync-symbols
 */

// Der Lauf spricht mit einem externen Dienst und schreibt in die Datenbank —
// er darf unter keinen Umständen aus einem Cache beantwortet werden.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      {
        error:
          'CRON_SECRET ist nicht gesetzt. Ohne Geheimnis läuft die Synchronisierung nicht — ' +
          'bitte in den Projekt-Einstellungen (und in .env.local) hinterlegen.',
      },
      { status: 500 },
    )
  }

  const header = req.headers.get('authorization')
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }

  const report = await runSymbolSync({ trigger: 'cron' })

  // Auch ein Lauf mit Teilfehlern gilt als erfolgreich beantwortet — sonst
  // wertet Vercel ihn als fehlgeschlagen, obwohl 90 von 93 Kursen frisch sind.
  // Der Zustand steht im Rumpf und im Protokoll (`symbol_sync_run`).
  return NextResponse.json({
    ok: report.error === null,
    symbolsTotal: report.symbolsTotal,
    resolvedNew: report.resolvedNew,
    stillUnresolved: report.stillUnresolved,
    quotesUpdated: report.quotesUpdated,
    quotesFailed: report.quotesFailed,
    durationMs: report.durationMs,
    error: report.error,
  })
}
