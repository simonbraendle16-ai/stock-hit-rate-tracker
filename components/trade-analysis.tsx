"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResearchMetricSummary } from "@/components/research-metric-summary";
import { researchMetrics, type MetricSample } from "@/lib/research-metrics";
import { summarizeTradeResearch, tradeResearchCoverage, type TradeResearchRow } from "@/lib/trade-research-coverage";

const labels: Record<string, string> = {
  status: "Status", wave: "Count/erwartete Welle", degree: "Wellengrad", direction: "Handelsrichtung",
  plan: "Plankontext", notes: "Qualitative Notiz", actualOutcome: "Tatsächlicher qualitativer Abschluss", currentCRV: "Aktuelles Plan-CRV",
};
const number = (value: number | null) => value == null ? "offen" : value.toLocaleString("de-DE", { maximumFractionDigits: 2 });

type Props = {rows: TradeResearchRow[]; samples: MetricSample[]; instrumentFiltered?: boolean; scopeLabel?: string};
export function TradeAnalysis(props: Props) {
  const unknown = props.rows.filter(r=>!r.kind);
  return <div className="flex flex-col gap-4">
    {(["money","demo"] as const).map(kind=><TradeGroup key={kind} kind={kind} {...props}
      rows={props.rows.filter(r=>r.kind === kind)} samples={props.samples.filter(r=>r.kind === kind)}
      scopeLabel={`${kind === "money" ? "Echtgeld" : "Demo"} · ${props.scopeLabel ?? "Alle eigenen Depots"}`} />)}
    {unknown.length > 0 ? <p>Ohne geprüfte Depotzuordnung: {unknown.map(r=>r.id).join(", ")}; aus getrennten Kennzahlen ausgeschlossen.</p> : null}
    {props.rows.some(r=>r.kindMismatch) ? <p className="text-sm">Abweichende Handelsart im Trade-Feld: {props.rows.filter(r=>r.kindMismatch).map(r=>r.id).join(", ")}. Die Auswertung verwendet das eigene Depot; gespeicherte Angaben wurden nicht korrigiert.</p> : null}
  </div>;
}
function TradeGroup({ rows, samples, kind, instrumentFiltered = false, scopeLabel = "Alle Depots" }: {
  rows: TradeResearchRow[]; samples: MetricSample[]; kind:"money" | "demo"; instrumentFiltered?: boolean; scopeLabel?: string;
}) {
  const summary = summarizeTradeResearch(rows);
  const coverage = tradeResearchCoverage(rows);
  return <Card>
    <CardHeader>
      <CardTitle>{scopeLabel} · {summary.total} eingetragene Trades</CardTitle>
      <CardDescription>Jeder gespeicherte Trade geht automatisch mit seinen vorhandenen Angaben ein. {scopeLabel}. {instrumentFiltered ? "Der Instrumentfilter gilt." : "Alle Instrumente."} Wellen-, Messart- und Erfassungsdatumsfilter gelten hier nicht. Fehlende Abrechnung begrenzt ausschließlich davon abhängige Ergebniskennzahlen.</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><p className="text-sm font-medium">Status · n={summary.total}</p><p className="text-sm">{summary.status.map(r => `${r.value}: ${r.n}`).join(" · ") || "Noch keine Trades"}</p></div>
        <div><p className="text-sm font-medium">Handelsrichtung · n={coverage.direction.n}</p><p className="text-sm">{summary.direction.map(r => `${r.value}: ${r.n}`).join(" · ") || "Noch keine Angaben"}</p></div>
        <div><p className="text-sm font-medium">Ø aktuelles Plan-CRV · {number(summary.currentCRV.average)}</p><p className="text-xs text-muted-foreground">n={summary.currentCRV.n} von {summary.currentCRV.denominator}. {summary.currentCRV.definition}</p></div>
        <div><p className="text-sm font-medium">Qualitative Trefferquote · {summary.actualOutcome.winRate == null ? "offen" : `${number(summary.actualOutcome.winRate * 100)} %`}</p><p className="text-sm">Gewinne: {summary.actualOutcome.wins} · Verluste: {summary.actualOutcome.losses} · Break-even: {summary.actualOutcome.breakeven}</p><p className="text-xs text-muted-foreground">n={summary.actualOutcome.n} von {summary.actualOutcome.denominator} abgeschlossenen Trades. {summary.actualOutcome.definition}</p></div>
      </div>
      <div className="text-sm">Count/erwartete Welle: {coverage.wave.n} · Wellengrad: {coverage.degree.n} · Plankontext: {coverage.plan.n} · qualitative Notiz: {coverage.notes.n} · jeweils von {summary.total} Trades</div>
      <details><summary className="cursor-pointer text-sm font-medium">Einbezogene Trades und fehlende Angaben je Kennzahl</summary>
        <div className="mt-3 flex flex-col gap-3">{Object.entries(coverage).filter(([, value]) => typeof value === "object").map(([key, raw]) => {
          const metric = raw as typeof coverage.status;
          return <details key={key}><summary>{labels[key]}: {metric.n} von {metric.denominator}</summary><p className="text-xs text-muted-foreground">{metric.definition}</p><p className="text-xs">Enthalten: {metric.included.map(r => r.id).join(", ") || "keine"}</p>{metric.excluded.map(r => <p className="text-xs" key={r.id}>Trade {r.id}: {r.reason}</p>)}</details>;
        })}</div>
      </details>
      <details><summary className="cursor-pointer text-sm font-medium">Alle {summary.total} Trades im Einzelnen</summary><div className="mt-3 flex flex-col gap-3">{rows.map(row => <details key={row.id}><summary>{row.ticker || "Trade"} · #{row.id} · {row.status} · {row.direction}</summary><Link href={`/trades/${row.id}`} className="text-sm underline">Trade öffnen</Link><p className="text-sm">Count: {row.wave || row.planContext?.expectedMove || "unbekannt"} · Grad: {row.degree || "unbekannt"} · Plan-CRV: {number(row.plannedCRV)}</p><p className="text-sm">{row.notes || "Keine Notiz"}</p></details>)}</div></details>
      <div><p className="mb-3 text-sm font-medium">Tatsächliche Nettoergebnisse und realisiertes R</p><ResearchMetricSummary metrics={researchMetrics(samples)} kinds={[kind]} /></div>
    </CardContent>
  </Card>;
}
