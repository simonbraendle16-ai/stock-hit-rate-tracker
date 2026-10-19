import type { fibonacciReadModel } from "@/lib/fibonacci-read-model";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Metric = {definition:string;n:number;denominator:number;included:{id:string;value:unknown}[];excluded:{id:string;reason:string}[]};
function evidenceText(value: unknown): string {
  if (value == null) return "unbekannt";
  if (Array.isArray(value)) return value.map(evidenceText).join(" · ");
  if (typeof value === "object") {
    const v=value as Record<string,unknown>;
    if (typeof v.label === "string") return [v.label,v.description,v.confidence,v.kind,v.outcome,v.resultR == null ? null : `${v.resultR} R`].filter(x=>x!=null).join(" · ");
  }
  if (typeof value === "number") return value.toLocaleString("de-DE");
  return String(value);
}
const label:Record<string,string> = {structure:"Struktur",direction:"Wellenrichtung",period:"Historische Zeit",duration:"Berichtete Wellendauer",reversalDuration:"Berichtete Umkehrdauer ? Altangabe",targetZoneReversal:"Zielzonenkontakt bis Wellenwendepunkt",reversalKind:"Genauigkeit der Wendepunktdauer",targetZoneResidence:"Zielzonen-Verweildauer",residenceKind:"Dauergenauigkeit",touchAndGo:"Touch-and-Go",targetZone:"Zielzone",reversalZone:"Umkehrzone",reached:"Bereits erreichte Levels",missed:"Berichtet verfehlte Levels",approximateReached:"Ungefähr erreichtes Level",basis:"Messbezug",unassignedLevels:"Unzugeordnete Levels",hypotheticalCRV:"Hypothetisches CRV",hypotheticalOutcome:"Hypothetischer Ausgang",hypotheticalExitLevel:"Hypothetischer Exit",hypotheticalCRVBasis:"CRV-Bezug",stopVariants:"Hypothetische Stopvarianten"};
function Evidence({metrics}:{metrics:Record<string,Metric>}) {
  return <div className="flex flex-col gap-2">{Object.entries(metrics).map(([key,m])=><details key={key}>
    <summary className="cursor-pointer text-sm">{label[key] ?? key}: {m.n} von {m.denominator}</summary>
    <p className="text-xs text-muted-foreground">{m.definition}</p>
    {m.included.map(r=><p className="break-words text-xs" key={r.id}>{r.id}: {evidenceText(r.value)}</p>)}
    {m.excluded.map(r=><p className="break-words text-xs text-muted-foreground" key={r.id}>{r.id}: {r.reason}</p>)}
  </details>)}</div>;
}
export function ResearchDataGroups({model}:{model:ReturnType<typeof fibonacciReadModel>}) {
  const {definition,total,...simulation} = model.simulationSummary;
  return <>
    {(["retracement","expansion"] as const).map(kind=>{
      const group=model.runningStatsByKind[kind];
      return <Card key={kind}><CardHeader><CardTitle>Laufende Wellen · {kind === "retracement" ? "Retracement" : "Expansion"} · {group.total} {group.total === 1 ? "Fall" : "Fälle"}</CardTitle><CardDescription>{group.definition}</CardDescription></CardHeader><CardContent><Evidence metrics={group.coverage}/></CardContent></Card>;
    })}
    <Card><CardHeader><CardTitle>Historische Simulation · Bezugsmenge {total} {total === 1 ? "Beobachtung" : "Beobachtungen"}</CardTitle><CardDescription>{definition}</CardDescription></CardHeader><CardContent><Evidence metrics={simulation}/></CardContent></Card>
    <p className="text-sm">Verknüpfte eigene Trades: {model.linkedTradeBasis.ids.join(", ") || "keine"}. Jeder Trade zählt einmal, nach seinem eigenen Status.</p>
    {model.linkedTradeBasis.excluded.map(r=><p className="text-xs" key={r.observationId}>{r.observationId}: {r.reason}</p>)}
  </>;
}
