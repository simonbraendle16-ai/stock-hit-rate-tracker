import Link from 'next/link'
import { readDemoCycle, type CycleScope } from '@/lib/demo-cycle'

const labels: Record<string,string> = {
  pending:'Restarbeit',blocked:'Daten-/Planblockade',broker:'Brokerbeleg',changed:'Inzwischen geändert',
  booked:'Buchung erfolgt',checked:'Geprüft · Marke nicht erreicht','market-closed':'Wartet auf geschlossenen Markt',
}
const at=(value:Date|string|null)=>value?new Date(value).toLocaleString('de-DE'):'noch nie'

export async function DemoCycleStatus({userId,portfolioId}:CycleScope) {
  let state
  try {state=await readDemoCycle({userId,portfolioId})} catch {
    return <p className="note mb-6" role="status">Demo-Ausführungsstatus derzeit nicht lesbar.</p>
  }
  if (!state) return <p className="note mb-6">Eigener Demozeitgeber für dieses Depot noch nicht eingerichtet.</p>
  const stale=!state.lastAutomaticAt||Date.now()-new Date(state.lastAutomaticAt).getTime()>15*60_000
  const late=new Date(state.nextRunAt).getTime()<Date.now()-15*60_000
  return <section className="panel mb-6 p-4" aria-label="Eigene Demo-Ausführung">
    <p className="eyebrow">Eigene Demo-Ausführung</p>
    <p className="mt-2 text-sm" role="status">
      {!state.enabled?'Zeitgeber noch nicht aktiviert.':stale?'Takt fehlt: kein aktueller automatischer Aufruf.':state.error?'Technischer Fehler; Fortsetzung erforderlich.':late?'Stundenprüfung überfällig.':state.phase!=='idle'?'Zyklus wird fortgesetzt.':'Stundenzyklus abgeschlossen; wartet auf nächste Fälligkeit.'}
    </p>
    <dl className="note mt-3 grid gap-2 text-xs sm:grid-cols-2">
      <div><dt>Letzter automatischer Aufruf</dt><dd>{at(state.lastAutomaticAt)}</dd></div>
      <div><dt>Letzter abgeschlossener Zyklus</dt><dd>{at(state.completedAt)}</dd></div>
      <div><dt>Nächste Fälligkeit / Fortsetzung</dt><dd>{at(state.nextRunAt)}</dd></div>
      <div><dt>Restarbeit</dt><dd>{'pending' in state.work?state.work.pending.length:0} Fälle · {state.phase==='collect'?'Kursversorgung':state.phase==='process'?'Verarbeitung':'keine offene Phase'}</dd></div>
    </dl>
    {state.error&&<p className="mt-3 text-sm text-destructive">{state.error}</p>}
    <ul className="mt-3 space-y-2 text-xs">
      {Object.entries(state.results).map(([id,result])=><li key={id}>
        <Link className="underline" href={`/trades/${id}`}>Fall #{id}</Link>: {labels[result.status]??result.status}
        {result.checkedAt&&` · Kerzen geprüft bis ${at(result.checkedAt)}`}{result.reason&&` · ${result.reason}`}
        {Boolean(result.bookings)&&` · ${result.bookings} Buchung(en) im Zyklus`}
      </li>)}
    </ul>
    <p className="note mt-3 text-xs">Papierhandel · stündliche Prüfung abgeschlossener 5-Minuten-Kerzen. Kursalarme laufen separat. Fachliche Blockaden bleiben auch bei erfolgreicher Zustellung bestehen.</p>
  </section>
}
