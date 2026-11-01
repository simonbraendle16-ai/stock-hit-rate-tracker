import type { ResearchTimeGroup } from '@/lib/research-time';
import { durationDefinitions, CALENDAR_TIME_NOTE } from '@/lib/fibonacci-duration-definitions';
import { formatWaveDegree } from '@/lib/wave-degree-labels';
import { ResearchDistribution } from './research-panorama';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/card';

const types={wave:'Wellendauer',reversal:durationDefinitions.reversal.label,residence:durationDefinitions.residence.label};
const conventions:Record<string,string>={whole_wave:'Gesamte Welle',first_entry_to_pivot:durationDefinitions.reversal.label,first_visit:'Erster Aufenthalt',total_visits:'Summe aller Aufenthalte',reversal:'Altangabe · Umkehrdauer mit offenen Messgrenzen',unknown:'Messgrenzen unbekannt'};
const bases:Record<string,string>={calendar:'Kalenderzeit',trading:'Altangabe · Handelszeit',unknown:'Zeitbasis unbekannt'};
const units:Record<string,string>={hour:'Stunden',minute:'Minuten',day:'Tage',calendar_hours:'Kalenderstunden',trading_hours:'Handelsstunden',trading_days:'Handelstage',unknown:'Einheit offen'};
const num=(v:number)=>v.toLocaleString('de-DE',{maximumFractionDigits:2});
function Exclusions({rows}:{rows:readonly {reason:string}[]}) {
  const counts=new Map<string,number>();for(const r of rows)counts.set(r.reason.replace('ungueltig','ungültig'),(counts.get(r.reason.replace('ungueltig','ungültig'))??0)+1);
  return <p>{rows.length} ausgeschlossen{rows.length ? `: ${[...counts].map(([r,n])=>`${r} (${n})`).join(' · ')}` : ''}.</p>;
}
export function ResearchTime({groups,perspective,state}:{groups:readonly ResearchTimeGroup[];perspective:'panorama'|'studio'|'structure';state:'loading'|'error'|'pending'|'ready'}) {
  if(state!=='ready' || !groups.length)return null;
  const detailed=perspective==='studio';
  return <section className="flex min-w-0 flex-col gap-5" aria-label="Zeit und Dauer" data-research-time={perspective}>
    <div className="flex flex-col gap-2"><h3 className="text-xl font-semibold">Zeit und Dauer</h3><p className="text-sm text-muted-foreground">{CALENDAR_TIME_NOTE} Alte Handelszeit und offene Messgrenzen bleiben eigene Gruppen. Klassen liefern keine Mittelwerte.</p></div>
    {groups.map(g=><section key={g.key} className="flex min-w-0 flex-col gap-4">
      <h4 className="break-words text-sm font-medium">{g.kind==='expansion'?'Expansion':'Retracement'} · Welle {g.wave} · {g.variant} · {formatWaveDegree(g.degree)} · {g.timeframe} · {g.direction==='short'?'Abwärts':g.direction==='long'?'Aufwärts':'Richtung unbekannt'} · {g.hierarchy} · Messbezug {g.basis} · {g.total} Beobachtungen</h4>
      <div className={cn('grid min-w-0 gap-5', !detailed && 'xl:grid-cols-2')}>
        <Card className="min-w-0"><CardHeader><CardTitle>Historische Zeit</CardTitle><CardDescription>Dokumentierter Wellenbeginn nach Jahr und Originalgenauigkeit. Alle Status; keine Erfassungsdaten als Ersatz. Ungefähre Angaben sind keine gesicherte Jahreszuordnung.</CardDescription></CardHeader><CardContent><ResearchDistribution detailed={detailed} label="Berichtetes Startjahr" n={g.chronology.n} rows={g.chronology.distribution}/></CardContent><CardFooter className="text-xs text-muted-foreground">{g.chronology.missing.length} ohne verwendbaren Wellenbeginn außerhalb n. Ein bekanntes Ende ersetzt keinen fehlenden Beginn. Keine Dauerschätzung aus Datumsgrenzen.</CardFooter></Card>
        {(['wave','reversal','residence'] as const).map(type=><Card key={type} className="min-w-0"><CardHeader><CardTitle>{types[type]}</CardTitle><CardDescription>{type==='wave'?'Berichtete Klassen der gesamten Welle.':durationDefinitions[type].description}</CardDescription></CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-5">
            {!g.durations.groups.some(d=>d.type===type)&&<p className="text-sm text-muted-foreground">Keine verwendbare Dauerklasse. Keine Quote berechenbar.</p>}
            {g.durations.groups.filter(d=>d.type===type).map((d,i)=><ResearchDistribution key={i} detailed={detailed} label={`${bases[d.timeBasis]} · ${conventions[d.convention] ?? d.convention}${d.legacyConvention && d.legacyConvention !== d.convention ? ` · ursprüngliche Messweise: ${conventions[d.legacyConvention] ?? d.legacyConvention}` : ''} · ${units[d.unit]}${d.zone ? ` · Zone ${d.zone.map(num).join('–')} %` : type==='wave' ? '' : ' · Zonenbezug nicht erhoben'}`} n={d.n} rows={d.distribution.filter(b=>b.n)}/>)}
            {type!=='wave' && <div className="flex flex-col gap-3 border-t border-border pt-4"><p className="text-sm font-medium">Exakte Messungen · getrennt von Klassen</p>
              {!g.exact[type].groups.length&&<p className="text-xs text-muted-foreground">Keine vergleichbaren exakten Messungen.</p>}
              {g.exact[type].groups.map((d,i)=><div key={i} className="break-words text-xs"><p>{bases[d.timeBasis]} · {conventions[d.convention] ?? d.convention} · Zone {d.zone.map(num).join('–')} % · n={d.n}</p><p className="mt-1 font-mono">Mittelwert {num(d.average)} · Median {num(d.median)} {units[d.unit]}</p></div>)}
              <Exclusions rows={g.exact[type].excluded}/>
              <p className="text-xs text-muted-foreground">Ungefähre Werte, Bereiche, Obergrenzen und unbekannte Dauern bleiben außerhalb exakter Mittelwerte.</p>
            </div>}
          </CardContent><CardFooter className="text-xs text-muted-foreground"><Exclusions rows={g.durations.excluded.filter(d=>d.type===type)}/></CardFooter></Card>)}
      </div>
    </section>)}
  </section>;
}
