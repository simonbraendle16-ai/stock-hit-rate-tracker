import type { StructureGroup } from '@/lib/research-structure';
import { formatWaveDegree } from '@/lib/wave-degree-labels';
import { ResearchDistribution } from '@/components/research-panorama';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

const number = (n:number)=>n.toLocaleString('de-DE',{maximumFractionDigits:1});
const zoneLabel = (z:readonly number[])=>z[0]===z[1] ? `${number(z[0])} % · Punktlevel` : `${number(z[0])}–${number(z[1])} % · Bereich`;
const confidenceLabel:Record<string,string> = {bestaetigt:'bestätigt',vermutet:'vermutet',unbekannt:'Sicherheit unbekannt'};
const waveLabel = (w:StructureGroup['waves'][number])=>`Welle ${w.wave}${['B','C'].includes(w.wave) ? ` · ${w.variant}` : ''}`;

export function ResearchStructure({groups,state,error}:{groups:readonly StructureGroup[];state:'loading'|'error'|'pending'|'ready';error?:string}) {
  if(state!=='ready' || !groups.length) return <Card role={state==='error'?'alert':'status'} aria-busy={state==='loading'}><CardHeader>
    <CardTitle>{state==='error'?'Strukturvergleich derzeit nicht verfügbar':state==='loading'?'Auswahl wird geladen':state==='pending'?'Suchauswahl noch nicht übernommen':'Keine passenden Beobachtungen'}</CardTitle>
    <CardDescription>{state==='error'?error || 'Daten konnten nicht geladen werden. Auswahl bleibt erhalten.':state==='loading'?'Die Datenbasis wird vorbereitet.':state==='pending'?'Kriterien klären und Suche übernehmen. Bis dahin keine Vergleichswerte.':'Filter oder Suche anpassen. Fehlende Grundlagen sind keine 0-%-Quote.'}</CardDescription>
  </CardHeader></Card>;
  return <div className="flex min-w-0 flex-col gap-8" data-research-structure="">
    <p className="text-sm text-muted-foreground">Gleiche Suchauswahl, getrennte Vergleichsgruppen. Jede Zeile nennt Anzahl, eigenen Nenner und Ausschlüsse. Kleine Stichproben bleiben explorativ; beobachtete Häufigkeiten sind keine Prognose.</p>
    {groups.map(g=><section key={g.key} className="flex min-w-0 flex-col gap-5" aria-label={`${g.kind} ${g.degree} ${g.timeframe} ${g.direction} ${g.hierarchy} ${g.basis}`}>
      <div className="flex flex-col gap-1"><h4 className="text-lg font-semibold">{g.kind==='expansion'?'Expansion':'Retracement'} · {formatWaveDegree(g.degree)} · {g.timeframe}</h4><p className="break-words text-xs text-muted-foreground">{g.hierarchy} · Richtung: {g.direction==='long'?'aufwärts':g.direction==='short'?'abwärts':'nicht erhoben'} · Messbezug: {g.basis} · {g.total} Beobachtungen in dieser Gruppe</p></div>
      <Card className="min-w-0"><CardHeader><CardTitle>Wellen und dokumentierte Umkehrlevel</CardTitle><CardDescription>Endlagen abgeschlossener Wellen. Punktlevel und Bereiche bleiben getrennt. Anteil je Wellenzeile; fehlende Endlagen stehen außerhalb von n.</CardDescription></CardHeader><CardContent className="min-w-0">
        {!g.zones.length ? <p className="text-sm text-muted-foreground">Keine verwendbaren Umkehrlevel in dieser Vergleichsgruppe.</p> : <div className="overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-ring" tabIndex={0} role="region" aria-label="Wellen-Levelmatrix horizontal scrollbar">
          <table className="w-full min-w-max text-left text-xs"><caption className="p-3 text-left text-muted-foreground">Umkehrmatrix · Anzahl / n · Zeilenanteil in % · — bedeutet keine Grundlage</caption>
            <thead><tr className="border-b border-border bg-muted/40"><th scope="col" className="p-3">Wellenkontext</th><th scope="col" className="p-3">Basis / n</th>{g.zones.map(z=><th scope="col" key={String(z)} className="max-w-40 p-3 text-right">{zoneLabel(z)}</th>)}<th scope="col" className="p-3 text-right">Ausgeschlossen</th></tr></thead>
            <tbody>{g.waves.map(w=><tr key={w.key} className="border-b border-border"><th scope="row" className="max-w-56 whitespace-normal p-3 font-medium">{waveLabel(w)}</th><td className="p-3 font-mono tabular-nums">{w.total} / {w.n}</td>{g.zones.map(z=>{
              const cell=w.levels.find(l=>l.zone[0]===z[0] && l.zone[1]===z[1]);
              return <td key={String(z)} className="p-3 text-right font-mono tabular-nums" style={w.n?{backgroundColor:`color-mix(in srgb, var(--primary) ${(cell?.share ?? 0)*0.22}%, transparent)`}:undefined}>{w.n?`${cell?.n ?? 0}/${w.n} · ${number(cell?.share ?? 0)} %`:'—'}</td>;
            })}<td className="p-3 text-right font-mono tabular-nums">{w.excluded.length}</td></tr>)}</tbody>
          </table>
        </div>}
        <div className="mt-4 flex flex-col gap-2 text-xs text-muted-foreground">{g.waves.map(w=><p key={w.key}>{waveLabel(w)} · {w.excluded.length} ausgeschlossen{exclusions(w.excluded)}</p>)}</div>
      </CardContent></Card>
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
        <Card className="min-w-0"><CardHeader><CardTitle>Muster je Wellenkontext</CardTitle><CardDescription>Dokumentierte Muster mit eigener Mustersicherheit. Bestätigte, vermutete und unbekannte Sicherheit bleiben getrennt; keine Ableitung aus Fibonacci-Werten.</CardDescription></CardHeader><CardContent className="flex min-w-0 flex-col gap-6">
          {g.waves.map(w=><div key={w.key} className="flex min-w-0 flex-col gap-4"><h5 className="text-sm font-medium">{waveLabel(w)} · Basis {w.total}</h5>{w.patterns.filter(p=>p.total).map(p=><div key={p.confidence}><ResearchDistribution label={`Muster ${confidenceLabel[p.confidence]}`} n={p.n} rows={p.distribution}/><p className="mt-2 text-xs text-muted-foreground">{p.excluded} ohne verwendbares Muster / nicht abgeschlossen · Teilgruppe {p.total}</p></div>)}</div>)}
        </CardContent></Card>
        <Card className="min-w-0"><CardHeader><CardTitle>Innere Unterteilung im Vergleich</CardTitle><CardDescription>Bestätigte dreiteilige und fünfteilige Angaben zählen unabhängig von exakten Prozentwerten. Muster und Unterteilung sind eigenständige Beobachtungen.</CardDescription></CardHeader><CardContent className="flex min-w-0 flex-col gap-6">
          {g.waves.flatMap(w=>w.subdivisions.map((s,i)=><div key={`${w.key}-${i}`}><ResearchDistribution label={`${waveLabel(w)} · ${s.patternLabel} (${confidenceLabel[s.patternConfidence]})`} n={s.n} rows={s.distribution}/><p className="mt-2 text-xs text-muted-foreground">Basis {s.denominator} · {s.uncertain.length} vermutet / unbekannt · {s.provisional.length} laufend · {s.excluded.length} ausgeschlossen{exclusions(s.excluded)}</p></div>))}
        </CardContent></Card>
      </div>
    </section>)}
  </div>;
}
function exclusions(rows:readonly {reason:string}[]) {
  const counts=new Map<string,number>();
  for(const r of rows) counts.set(r.reason,(counts.get(r.reason) ?? 0)+1);
  return counts.size ? `: ${[...counts].map(([reason,n])=>`${reason} (${n})`).join(' · ')}` : '';
}
