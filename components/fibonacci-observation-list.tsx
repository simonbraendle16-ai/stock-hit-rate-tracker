"use client";
import { timeLabel } from "@/lib/fibonacci-time";
import { formatWaveDegree } from "@/lib/wave-degree-labels";

import { Pencil, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FibObservation } from "@/lib/fibonacci";
import { formatResearchPercent } from "@/lib/fibonacci-workspace";
import { DURATION_CLASSES } from "@/lib/fibonacci-catalogue";
import { residenceLabel } from "@/lib/fibonacci-residence";

const statusName = {
  laufend: "Laufend",
  abgeschlossen: "Abgeschlossen",
  unklar: "Unklar",
  ungueltig: "Ungültig",
};
const date = (value: string) => value.split("-").reverse().join(".");

function Details({ row }: { row: FibObservation }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-primary underline-offset-4 hover:underline">
        Quelle & Messdetails
      </summary>
      <div className="mt-3 flex flex-col gap-2 break-words text-muted-foreground">
        <p className="whitespace-pre-wrap">{row.note}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
          {[
            ["Quelle", row.sourceRef || "Keine Quelle angegeben"],
            ["Bezugsbasis", row.measurementBasis],
            ["Erreichte Levels", row.evidence?.reachedLevels?.join(" / ")],
            ["Verfehlte Levels", row.evidence?.missedLevels?.join(" / ")],
            ["Umkehrzone", row.evidence?.reversalZone?.join(" bis ")],
            ["Erwartete Zielzone", row.evidence?.targetZone?.join(" bis ")],
            ["Mögliche Einstiegszone", row.evidence?.entryZone?.join(" bis ")],
            ["Zielzone erreicht", row.evidence?.targetContact === "reached" ? "Ja" : row.evidence?.targetContact === "not_reached" ? "Nein" : "Unbekannt"],
            ...(["wave","reversal","residence"] as const).map(k=>[({wave:"Wellendauerklasse",reversal:"Umkehrdauerklasse",residence:"Aufenthaltsdauerklasse"})[k], DURATION_CLASSES.find(([id])=>id===row.evidence?.durations?.[k]?.bucket)?.[1]]),
            ["Verweildauer in der Zielzone", residenceLabel(row.evidence?.targetZoneResidence)],
            ["Ursprüngliche Dauerangabe", row.evidence?.targetZoneResidence?.originalText],
            ["Zeitbasis der Verweildauer", row.evidence?.targetZoneResidence ? ({unknown:"Noch offen",calendar:"Kalenderzeit",trading:"Handelszeit"}[row.evidence.targetZoneResidence.timeBasis]) : null],
            ["Messkonvention der Verweildauer", row.evidence?.targetZoneResidence?.measurementConvention || (row.evidence?.targetZoneResidence ? "Noch offen" : null)],
            ["Wellenrichtung", row.evidence?.waveDirection],
            ["Ungefähre Messung %", row.evidence?.approximatePercent != null ? String(row.evidence.approximatePercent) : null],
            ["Hypothetisches CRV", row.evidence?.hypotheticalCRV != null ? `1:${row.evidence.hypotheticalCRV}` : null],
            ["Historischer Zeitraum", row.evidence?.periodLabel],
            ["Elternwelle", row.evidence?.parentId],
            ["Zeitquelle", row.evidence?.historicalTime?.source],
            ["Herkunft strukturierter Angaben", row.evidence?.provenance],
            ["Struktur", row.structure],
            [
              "Referenzanker",
              row.anchorStart != null
                ? `${row.anchorStart} → ${row.anchorEnd} · Extrem ${row.extreme}`
                : null,
            ],
            [
              "Zeitraum",
              row.evidence?.historicalTime || row.periodFrom || row.periodTo
                ? timeLabel(row)
                : null,
            ],
            ["Kursziel", row.target != null ? String(row.target) : null],
            ["Stopbeschreibung", row.stopDescription],
            ["Handelbarkeit", row.tradability || "unbekannt"],
            ["Hypothetischer Ausgang", row.hypotheticalOutcome || "unbekannt"],
            ["Tatsächlicher Ausgang", row.actualOutcome || "unbekannt"],
            [
              "Stopvarianten",
              row.stopVariants?.length ? String(row.stopVariants.length) : null,
            ],
            ["Kursdatensatz", row.historyId],
            ["Quellenkennung", row.sourceKey],
          ]
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label} className="contents">
                <dt>{label}</dt>
                <dd className="min-w-0 break-words text-foreground">{value}</dd>
              </div>
            ))}
        </dl>
        {row.tradeId && (
          <Link
            href={`/trades/${row.tradeId}`}
            className="inline-flex items-center gap-1 text-primary"
          >
            Trade {row.tradeId} öffnen <ArrowUpRight className="size-3" />
          </Link>
        )}
        <p className="break-all font-mono text-[10px]">
          Beobachtung {row.id} · Version {row.version}
        </p>
      </div>
    </details>
  );
}

export function FibonacciObservationList({
  rows,
  onEdit,
}: {
  rows: FibObservation[];
  onEdit: (row: FibObservation) => void;
}) {
  const edit = (row: FibObservation) => (
    <Button
      variant="outline"
      size="sm"
      className="min-h-10 sm:min-h-0"
      onClick={() => onEdit(row)}
      aria-label={`Messung ${row.ticker} ${row.observedOn} bearbeiten`}
    >
      <Pencil data-icon="inline-start" />
      Bearbeiten
    </Button>
  );
  return (
    <>
      <div className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <article
            key={row.id}
            className="rounded-lg border border-border bg-background/40 p-4"
            aria-label={`${row.ticker} · Welle ${row.wave} · ${date(row.observedOn)}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono font-semibold">{row.ticker}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Welle {row.wave} · {formatWaveDegree(row.degree)} · {row.timeframe}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-xl">
                  {row.evidence?.reversalZone ? `${row.evidence.reversalZone.join("–")} % · Umkehr` : row.evidence?.reachedLevels?.length ? `${row.evidence.reachedLevels.join(" / ")} % · erreicht` : formatResearchPercent(row.percent)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.measurementKind === "expansion"
                    ? "Expansion"
                    : "Retracement"}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{statusName[row.status]}</Badge>
              {row.percent == null && !row.evidence?.reversalZone && !row.evidence?.reachedLevels?.length && (
                <Badge variant="secondary">Keine Levelangabe</Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {date(row.observedOn)}
              </span>
            </div>
            <Details row={row} />
            <div className="mt-4 flex justify-end">{edit(row)}</div>
          </article>
        ))}
      </div>
      <div className="relative hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Messprotokoll mit Quelle, Wellenkontext und Bearbeitung
          </caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="pb-3 pr-4">
                Instrument / Datum
              </th>
              <th scope="col" className="pb-3 pr-4">
                Wellenkontext
              </th>
              <th scope="col" className="pb-3 pr-4">
                Messwert
              </th>
              <th scope="col" className="pb-3 pr-4">
                Status / Quelle
              </th>
              <th scope="col" className="pb-3 text-right">
                Aktion
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-border/60 align-top last:border-0 hover:bg-muted/30"
              >
                <th scope="row" className="py-4 pr-4 text-left font-normal">
                  <span className="font-mono font-semibold">{row.ticker}</span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {date(row.observedOn)}
                  </p>
                </th>
                <td className="py-4 pr-4">
                  Welle {row.wave}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatWaveDegree(row.degree)} · {row.timeframe}
                  </p>
                </td>
                <td className="py-4 pr-4">
                  <span className="whitespace-nowrap font-mono font-medium">
                    {row.evidence?.reversalZone ? `${row.evidence.reversalZone.join("–")} % · Umkehr` : row.evidence?.reachedLevels?.length ? `${row.evidence.reachedLevels.join(" / ")} % · erreicht` : formatResearchPercent(row.percent)}
                  </span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {row.percent == null
                      ? row.evidence?.reversalZone || row.evidence?.reachedLevels?.length ? "Levelbeobachtung" : "Keine Levelangabe"
                      : row.measurementKind === "expansion"
                        ? "Expansion"
                        : "Retracement"}
                  </p>
                </td>
                <td className="max-w-sm py-4 pr-4">
                  <Badge variant="outline">{statusName[row.status]}</Badge>
                  <Details row={row} />
                </td>
                <td className="py-4 text-right">{edit(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
