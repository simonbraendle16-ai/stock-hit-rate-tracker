import { runAlertCheck } from '@/lib/alert-run'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Der Lauf, der aus einem Kurs-Alert eine Nachricht macht.
 *
 * WARUM NICHT IN `vercel.json`
 * Vercel-Hobby lässt genau EINEN Cron-Lauf pro Tag zu und lehnt sonst das ganze
 * Deployment ab (siehe CLAUDE.md — hat schon zwei Tage gekostet). Ein Alarm, der
 * einmal täglich prüft, ist keiner. Den Takt gibt deshalb ein externer Dienst
 * vor: `.github/workflows/check-alerts.yml` (alle 5 Minuten) oder ein Job bei
 * cron-job.org auf dieselbe URL. `vercel.json` bleibt unangetastet.
 *
 * Von Hand anstoßen (PowerShell):
 *   curl -H "Authorization: Bearer $env:CRON_SECRET" https://<deine-app>/api/cron/check-alerts
 */

// Prüft Kurse, schreibt in die Datenbank und verschickt Mail — darf unter keinen
// Umständen aus einem Cache beantwortet werden.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      {
        error:
          'CRON_SECRET ist nicht gesetzt. Ohne Geheimnis läuft die Alarm-Prüfung nicht — ' +
          'bitte in den Projekt-Einstellungen (und in .env.local) hinterlegen.',
      },
      { status: 500 },
    )
  }

  const header = req.headers.get('authorization')
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }

  const report = await runAlertCheck({ trigger: 'cron' })

  // Auch ein Lauf mit Teilfehlern (eine Mail ging nicht raus) gilt als
  // beantwortet — sonst wertet der externe Dienst ihn als Ausfall, obwohl die
  // Alerts korrekt ausgelöst haben. Der Zustand steht im Rumpf und in
  // `alert_check_run`; ungesendete Meldungen holt der nächste Lauf nach.
  return NextResponse.json({
    ok: report.error === null,
    alertsOpen: report.alertsOpen,
    triggered: report.triggered,
    mailsSent: report.mailsSent,
    mailsFailed: report.mailsFailed,
    error: report.error,
  })
}
