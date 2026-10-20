import type { ReactNode } from 'react';
import type { PanoramaGroup } from '@/lib/research-panorama';
import { formatWaveDegree } from '@/lib/wave-degree-labels';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';

const number = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 });
const percent = (n: number | null) => n === null ? '—' : `${number(n)} %`;
const zone = (z: readonly number[]) => z[0] === z[1] ? `${number(z[0])} % · Punktlevel` : `${number(z[0])}–${number(z[1])} % · Bereich`;
const context = (g: {wave: string; degree: string; timeframe: string}) => `Welle ${g.wave} · ${formatWaveDegree(g.degree)} · ${g.timeframe}`;
const timing: Record<string, string> = {before:'Vorab festgelegt',prior:'Vorab festgelegt',retrospective:'Rückblickend',unknown:'Zeitpunkt unbekannt'};
const families: Record<string,string> = {impulse:'Impuls',diagonal:'Diagonal',abc:'ABC',abc_flat:'ABC-Flat',triangle:'Dreieck',wxy:'WXY',wxyxz:'WXYXZ'};
const confidence: Record<string,string> = {bestaetigt:'bestätigt',vermutet:'vermutet',unbekannt:'unbekannt'};

function Module({ title, description, children, footer }: {title: string; description: string; children: ReactNode; footer: ReactNode}) {
  return <Card className="min-w-0 h-full">
    <CardHeader><CardTitle><h4>{title}</h4></CardTitle><CardDescription>{description}</CardDescription></CardHeader>
    <CardContent className="flex flex-col gap-5">{children}</CardContent>
    <CardFooter className="mt-auto"><div className="text-xs text-muted-foreground">{footer}</div></CardFooter>
  </Card>;
}

/** Visible labels carry the same information as the bars; no hover or colour-only meaning. */
export function ResearchDistribution({ label, rows, n }: {label: string; rows: readonly {label: string; n: number; share: number | null}[]; n: number}) {
  return <figure className="min-w-0 flex flex-col gap-3" aria-label={label}>
    <figcaption className="text-sm font-medium break-words">{label} <span className="text-muted-foreground">· n={n}</span></figcaption>
    {!n ? <p className="text-sm text-muted-foreground">Keine verwendbare Grundlage. Anteil nicht berechenbar.</p> :
      <ul className="flex flex-col gap-3">{rows.map(r => <li key={r.label} className="min-w-0" title={`${r.label}: ${r.n} von ${n} · ${percent(r.share)}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs"><span className="break-words">{r.label}</span><span className="font-mono tabular-nums">{r.n}/{n} · {percent(r.share)}</span></div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{width: `${r.share ?? 0}%`}} /></div>
      </li>)}</ul>}
    {n > 0 && <div className="flex justify-between text-[10px] text-muted-foreground" aria-hidden="true"><span>0 %</span><span>Anteil an n</span><span>100 %</span></div>}
  </figure>;
}

function Exclusions({rows}: {rows: readonly {reason: string}[]}) {
  const counts = new Map<string,number>();
  for (const row of rows) {
    const reason=row.reason.replace('ungueltig','ungültig');
    counts.set(reason,(counts.get(reason) ?? 0)+1);
  }
  return <p>{rows.length} ausgeschlossen{rows.length ? `: ${[...counts].map(([reason,n])=>`${reason} (${n})`).join(' · ')}` : ''}.</p>;
}

function PanoramaMetrics({group: g}: {group: PanoramaGroup}) {
  const c = g.categorical;
  return <section className="flex min-w-0 flex-col gap-5" aria-label={`${g.kind === 'retracement' ? 'Retracement' : 'Expansion'}-Statistik`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3"><h3 className="text-xl font-semibold">{g.kind === 'retracement' ? 'Retracement' : 'Expansion'}</h3><p className="text-xs text-muted-foreground">{g.total} Beobachtungen · {g.completed} abgeschlossen · eigene Basis je Kennzahl</p></div>
    <div className="grid min-w-0 gap-5 xl:grid-cols-3">
      <div className="min-w-0 xl:col-span-2"><Module title="Wo Wellen umkehren" description="Dokumentierte Endlagen abgeschlossener Wellen. Punktlevel und Bereiche bleiben getrennt." footer={<Exclusions rows={c.reversals.excluded} />}>
        {!c.reversals.groups.length && <p className="text-sm text-muted-foreground">Noch keine bestätigten Umkehrlevel oder Umkehrbereiche in dieser Auswahl.</p>}
        {c.reversals.groups.map((r,i)=><ResearchDistribution key={i} label={context(r)} n={r.n} rows={r.distribution.map(d=>({label:zone(d.zone),n:d.n,share:d.share}))} />)}
      </Module></div>
      <Module title="Welche Muster auftreten" description="Bekannte Strukturfamilien. Untertypen werden innerhalb ihrer Familie gezählt." footer={`${g.structures.excluded} ohne verwendbare Strukturfamilie: fehlend, unbekannt, ungeklärt oder nicht abgeschlossen. Keine Ableitung der inneren Unterteilung.`}>
        <ResearchDistribution label="Strukturfamilien" n={g.structures.n} rows={g.structures.distribution.filter(d=>d.n).map(d=>({...d,label:families[d.label] ?? d.label}))} />
        <p className="text-xs text-muted-foreground">{g.structures.distribution.filter(d=>!d.n).length} weitere Katalogfamilien ohne beobachteten Fall im Nenner.</p>
      </Module>
    </div>
    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      <Module title="Welche Levels erreicht werden" description="Jedes Level hat seinen eigenen Nenner. Eine Welle kann mehrere Levels erreichen; Zeilen nicht addieren." footer="Erreicht = Akzentbalken · verfehlt und ohne bestätigte Angabe separat. Keine endgültige Umkehrverteilung.">
        {!c.levels.some(l=>l.n) && <p className="text-sm text-muted-foreground">Noch keine bestätigte Levelerreichung oder Verfehlung. Keine Quote berechenbar.</p>}
        {c.levels.filter(l=>l.n).map(l=><div key={l.level}>
          <ResearchDistribution label={`${number(l.level)} %`} n={l.n} rows={[{label:'Erreicht',n:l.reached.length,share:l.share}]} />
          <p className="mt-1 text-xs text-muted-foreground">{l.missed.length} verfehlt · {l.excluded.length} ohne bestätigte Angabe / ausgeschlossen</p>
        </div>)}
        <p className="text-xs text-muted-foreground">{c.levels.filter(l=>!l.n).length} Kataloglevel ohne bekannte Grundlage; keine 0-%-Werte.</p>
      </Module>
      <Module title="Umkehr in der erwarteten Zone" description="Nur eine belegte Endlage zählt. Berührung oder Durchlaufen allein ist kein Treffer." footer={`${g.total - c.targets.reduce((n,t)=>n+t.hit.length+t.miss.length+t.unknown.length,0)} ohne dokumentierte Zielzone. Beobachtete Häufigkeit, keine Prognose- oder Gewinnquote.`}>
        {!c.targets.length && <p className="text-sm text-muted-foreground">Noch keine dokumentierten Zielzonen. Unbekannt ist kein verfehltes Ziel.</p>}
        {c.targets.map((t,i)=><div key={i}><ResearchDistribution label={`${context(t)} · ${zone(t.zone)} · ${timing[t.timing] ?? t.timing}`} n={t.n} rows={[{label:'Umkehr innerhalb der Zone',n:t.hit.length,share:t.share}]} /><p className="mt-2 text-xs text-muted-foreground">{t.miss.length} verfehlt · {t.unknown.length} unbekannt außerhalb n</p></div>)}
      </Module>
    </div>
    <div className="grid min-w-0 gap-5 xl:grid-cols-2">
      <Module title="Innere Wellenunterteilung" description="Bestätigte dreiteilige und fünfteilige Unterteilungen zählen auch ohne exakten Fibonacci-Prozentwert. Muster und Mustersicherheit bleiben eigenständig." footer="Vermutete und unbekannte abgeschlossene Angaben, laufende Fälle und weitere Ausschlüsse zählen nicht in den bestätigten Nenner.">
        {!c.subdivisions.length && <p className="text-sm text-muted-foreground">Keine Unterteilungsgrundlage.</p>}
        {c.subdivisions.map((s,i)=><div key={i}><ResearchDistribution label={`${context(s)} · Muster: ${s.patternLabel} (${confidence[s.patternConfidence] ?? s.patternConfidence})`} n={s.n} rows={s.distribution.map(d=>({label:d.label,n:d.n,share:d.share}))} /><p className="mt-2 text-xs text-muted-foreground">{s.uncertain.length} vermutet / unbekannt · {s.provisional.length} laufend · Basis {s.denominator}</p><Exclusions rows={s.excluded}/></div>)}
      </Module>
      <Module title="Dokumentierte Wellenvarianten" description="B überschießend, B unterschießend und C truncated bleiben explizit erfasste Untergruppen ihrer Grundwelle." footer="Keine automatische Einstufung aus Fibonacci-Werten oder Mustern. Nicht klassifizierte Fälle bleiben ausgeschlossen.">
        {!c.waveVariants.length && <p className="text-sm text-muted-foreground">Keine B-/C-Wellen in dieser Auswahl.</p>}
        {c.waveVariants.map((v,i)=><div key={i}><ResearchDistribution label={context(v)} n={v.n} rows={v.distribution.map(d=>({label:d.label,n:d.n,share:d.share}))}/><Exclusions rows={v.excluded}/></div>)}
      </Module>
    </div>
  </section>;
}

export function ResearchPanorama({groups, state, error}: {groups: readonly PanoramaGroup[]; state: 'loading' | 'error' | 'pending' | 'ready'; error?: string}) {
  if (state !== 'ready') return <Card role={state === 'error' ? 'alert' : 'status'} aria-busy={state === 'loading'}><CardHeader><CardTitle>{state === 'error' ? 'Statistik derzeit nicht verfügbar' : state === 'loading' ? 'Auswahl wird geladen' : 'Suchauswahl noch nicht übernommen'}</CardTitle><CardDescription>{state === 'error' ? error || 'Die Daten konnten nicht ausgewertet werden. Auswahl bleibt erhalten.' : state === 'loading' ? 'Die Datenbasis wird vorbereitet. Noch keine endgültigen Kennzahlen.' : 'Kriterien klären und Suche übernehmen. Bis dahin keine endgültigen Kennzahlen.'}</CardDescription></CardHeader></Card>;
  if (!groups.some(g=>g.total)) return <Card role="status"><CardHeader><CardTitle>Keine passenden Beobachtungen</CardTitle><CardDescription>Diese Auswahl ist leer. Filter oder Suche anpassen; fehlende Daten sind keine 0-%-Quote.</CardDescription></CardHeader></Card>;
  return <div className="flex min-w-0 flex-col gap-8" data-research-panorama>
    <p className="text-xs text-muted-foreground">Beobachtete Häufigkeiten · abgeschlossene Fälle je Kennzahl · unbekannte Angaben außerhalb des Nenners. Kleine Stichproben bleiben explorativ.</p>
    {groups.map(g=>g.total ? <PanoramaMetrics key={g.kind} group={g}/> : <p key={g.kind} className="text-sm text-muted-foreground">{g.kind === 'expansion' ? 'Expansion' : 'Retracement'}: keine Beobachtungen in dieser Auswahl.</p>)}
  </div>;
}
