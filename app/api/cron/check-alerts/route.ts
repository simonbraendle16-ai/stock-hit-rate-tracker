import { runAlertCheck } from '@/lib/alert-run'
import { NextRequest, NextResponse } from 'next/server'
import { alertCronAuthorized } from '@/lib/alert-cron-auth'

/**
 * Der Lauf, der aus einem Kurs-Alert eine Nachricht macht.
 *
 * WARUM NICHT IN `vercel.json`
 * Vercel-Hobby lässt genau EINEN Cron-Lauf pro Tag zu und lehnt sonst das ganze
 * Deployment ab (siehe CLAUDE.md — hat schon zwei Tage gekostet). Ein Alarm, der
 * einmal täglich prüft, ist keiner. Den Takt gibt deshalb ein externer Dienst
 * vor: cron-job.org alle fünf Minuten, mit eigenem ALERT_CRON_SECRET.
 * GitHub-Alarmworkflow bleibt deaktiviert; Demo-Verarbeitung bleibt separat.
 *
 * Von Hand anstoßen (PowerShell):
 * Das eigene Alarm-Geheimnis berechtigt ausschließlich diesen Endpunkt.
 */

// Prüft Kurse, schreibt in die Datenbank und verschickt Mail — darf unter keinen
// Umständen aus einem Cache beantwortet werden.
export const dynamic = 'force-dynamic'
export const maxDuration = 25

export async function GET(req: NextRequest) {
  const secret = process.env.ALERT_CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      {
        error:
          'ALERT_CRON_SECRET ist nicht gesetzt. Ohne eigenes Alarm-Geheimnis läuft die Prüfung nicht — ' +
          'bitte in den Projekt-Einstellungen (und in .env.local) hinterlegen.',
      },
      { status: 500 },
    )
  }

  const header = req.headers.get('authorization')
  if (!alertCronAuthorized(header, secret)) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }

  try {
    const report = await runAlertCheck({ trigger: 'cron' })
    // 202 means persisted work remains. Only 200 confirms a complete successful pass.
    return NextResponse.json({
    ok: report.complete,
    complete: report.complete,
    busy: report.busy,
    remaining: report.remaining,
    quotesMissing: report.quotesMissing,
    quotesPaused: report.quotesPaused,
    alertsOpen: report.alertsOpen,
    triggered: report.triggered,
    mailsSent: report.mailsSent,
    mailsFailed: report.mailsFailed,
    error: report.error,
  }, { status: report.complete ? 200 : report.busy ? 409 : report.remaining && !report.error && !report.mailsFailed ? 202 : 503 })
  } catch {
    return NextResponse.json({ ok: false, error: 'Alarmprüfung konnte nicht gestartet oder abgeschlossen werden.' }, { status: 503 })
  }
}
