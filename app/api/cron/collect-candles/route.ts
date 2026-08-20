import { runCandleCollect } from '@/lib/market-data/candle-collect'
import { leererDemoBericht, runDemoFills } from '@/lib/demo-run'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Der Lauf, der den Kerzenspeicher füllt (Migration 0027).
 *
 * WARUM ER AM 5-MINUTEN-TAKT HÄNGT UND TROTZDEM NICHT ALLE 5 MINUTEN ARBEITET
 * Vercel-Hobby lässt genau EINEN Cron-Lauf pro Tag zu (siehe CLAUDE.md — das
 * hat schon zwei Tage gekostet). Den Takt gibt deshalb derselbe
 * GitHub-Workflow vor, der die Alarme prüft. Damit daraus keine 288 Läufe am
 * Tag werden, entscheidet die Route SELBST, ob sie fällig ist
 * (`RUN_INTERVAL_MS`, zwei Stunden) und antwortet sonst mit `ran: false`.
 *
 * Die Fälligkeit im Code statt im Zeitplan zu führen hat einen zweiten Vorteil:
 * Fällt der Takt für einen halben Tag aus, arbeitet der nächste Aufruf sofort —
 * ein zweiter Zeitplan hätte stattdessen bis zu seinem nächsten Termin gewartet.
 *
 * Von Hand anstoßen (PowerShell):
 *   curl.exe -H "Authorization: Bearer $secret" https://<app>/api/cron/collect-candles?force=1
 */

// Holt Kerzen und schreibt sie — darf nie aus einem Cache beantwortet werden.
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

  const force = req.nextUrl.searchParams.get('force') === '1'
  const report = await runCandleCollect({ trigger: 'cron', force })

  // Der Demo-Handel hängt an DIESEM Takt, nicht an den Alarmen (Teil 2).
  //
  // Zwei Gründe. Erstens die Fälligkeit: Diese Route prüft selbst, ob sie dran
  // ist (stündlich) — ein eigener Merker für den Demo-Lauf erübrigt sich damit.
  // Zweitens der Egress: Am 5-Minuten-Takt läse der Demo-Lauf rund 17,5 GB im
  // Monat, hier sind es etwa 18 MB. Das kostet keine Genauigkeit, weil die
  // gebuchte Ausführungszeit die KERZENZEIT ist und nicht die Laufzeit.
  //
  // Nur wenn der Sammellauf wirklich lief: Sonst prüfte der Demo-Lauf gegen
  // denselben Kerzenstand wie beim letzten Mal — Arbeit ohne neue Erkenntnis.
  // Ein Fehler hier darf das Sammeln nicht mitreißen, deshalb der eigene Fang.
  const demo = report.ran
    ? await runDemoFills().catch((err: unknown) => ({
        ...leererDemoBericht(),
        error: err instanceof Error ? err.message : String(err),
      }))
    : leererDemoBericht()

  // Auch ein Lauf mit einzelnen Fehlschlägen gilt als beantwortet — sonst
  // wertet der externe Dienst ihn als Ausfall, obwohl der Speicher gewachsen
  // ist. Ein unbekanntes Symbol steht an seiner Reihe, nicht am ganzen Lauf.
  return NextResponse.json({
    ok: report.error === null,
    ran: report.ran,
    skipped: report.skipped,
    seriesDue: report.seriesDue,
    seriesFetched: report.seriesFetched,
    seriesFailed: report.seriesFailed,
    candlesAdded: report.candlesAdded,
    candlesPruned: report.candlesPruned,
    error: report.error,
    // Getrennt ausgewiesen: Ein stiller Fehlschlag im Demo-Handel saehe von
    // aussen aus wie „es war nichts auszufuehren".
    demo: {
      ran: demo.ran,
      einstiege: demo.einstiege,
      teilziele: demo.teilziele,
      abschluesse: demo.abschluesse,
      vorFenster: demo.vorFenster,
      // Verworfen, weil die Depotdeckung nicht mehr reichte (Teil 3). Gehoert
      // ausgewiesen: Ein abgebrochener Trade, der nirgends auftaucht, sieht von
      // aussen aus wie einer, bei dem nichts passiert ist.
      ungedeckt: demo.ungedeckt,
      unvollstaendig: demo.unvollstaendig,
      ohneKerzen: demo.ohneKerzen,
      error: demo.error,
    },
  })
}
