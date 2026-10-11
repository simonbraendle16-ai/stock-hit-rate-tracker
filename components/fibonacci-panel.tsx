"use client";
import { useMemo, useState, useTransition, useId } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Plus, Pencil, Waves, ArrowRight } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { saveFibonacci } from "@/app/actions/fibonacci";
import {
  FIB_LEVELS,
  FIB_WAVES,
  FIB_DEGREES,
  FIB_TIMEFRAMES,
  filterFib,
  fibStats,
  fibCsv,
  retracement,
  type FibObservation,
  type FibFilters,
} from "@/lib/fibonacci";
import { researchMetrics, type MetricSample } from "@/lib/research-metrics";
import { ResearchMetricSummary } from "@/components/research-metric-summary";
import {
  FibonacciHistoryPanel,
  type HistorySummary,
} from "@/components/fibonacci-history-panel";
import { StopVariantsEditor } from "@/components/fibonacci-stop-variants";
import { cn } from "@/lib/utils";
type Instrument = { id: number; name: string; ticker: string; market: string };
type Props = {
  observations: FibObservation[];
  instruments: Instrument[];
  stockId?: number;
  samples?: MetricSample[];
  histories?: HistorySummary[];
};
const fmt = (n: number | null) =>
  n === null
    ? "Nicht berechenbar"
    : n.toLocaleString("de-DE", { maximumFractionDigits: 1 });
const marketNames: Record<string, string> = {
  aktien: "Aktien",
  krypto: "Krypto",
  forex: "Forex",
  rohstoffe: "Rohstoffe",
  etf: "ETF",
  optionen: "Optionen",
  sonstiges: "Sonstige",
};
function Choice({
  label,
  value,
  onChange,
  options,
  all = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  all?: boolean;
}) {
  const id = useId();
  const items = [...(all ? [{ value: "all", label: "Alle" }] : []), ...options];
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={items}
        value={value || "all"}
        onValueChange={(v) => onChange(v === "all" ? "" : String(v ?? ""))}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
const choices = (values: readonly string[]) =>
  values.map((v) => ({ value: v, label: v }));
export function FibonacciPanel({
  observations,
  instruments,
  stockId,
  samples = [],
  histories = [],
}: Props) {
  const [filters, setFilters] = useState<FibFilters>({
      stockId,
      measurementKind: "retracement",
    }),
    [editing, setEditing] = useState<FibObservation | null>(null),
    [open, setOpen] = useState(false),
    [page, setPage] = useState(0);
  const filtered = useMemo(
      () => filterFib(observations, filters),
      [observations, filters],
    ),
    stats = useMemo(
      () => fibStats(filtered, filters.measurementKind),
      [filtered, filters.measurementKind],
    );
  const waveLabels = [
    ...new Set([...FIB_WAVES, ...observations.map((r) => r.wave)]),
  ];
  const linkedIds = new Set(
    filtered.flatMap((r) =>
      r.status === "abgeschlossen" && r.tradeId ? [r.tradeId] : [],
    ),
  );
  const metrics = researchMetrics(samples.filter((s) => linkedIds.has(s.id)));
  const set = (key: keyof FibFilters, value: string) => {
    setFilters((f) => ({
      ...f,
      [key]:
        key === "stockId"
          ? value
            ? Number(value)
            : undefined
          : value || undefined,
    }));
    setPage(0);
  };
  const waves = waveLabels.map((wave) => ({
    wave,
    stats: fibStats(
      filtered.filter((r) => r.wave === wave),
      filters.measurementKind,
    ),
  }));
  const groups = instruments
    .map((i) => ({
      instrument: i,
      stats: fibStats(
        filtered.filter((r) => r.stockId === i.id),
        filters.measurementKind,
      ),
    }))
    .filter((g) => g.stats.n > 0)
    .sort((a, b) => b.stats.n - a.stats.n);
  const maxCount = Math.max(1, ...stats.zones.map((z) => z.count));
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 20) - 1),
  );
  const shown = filtered.slice(currentPage * 20, (currentPage + 1) * 20);
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([fibCsv(filtered)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "fibonacci-beobachtungen.csv";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section
      id="fibonacci"
      aria-label="Fibonacci-Auswertung"
      className="mt-8 flex min-w-0 flex-col gap-5 overflow-x-clip"
    >
      <div className="flex flex-wrap items-end justify-between gap-4 border-t border-border pt-8">
        <div>
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-primary">
            Wellen · empirisch beobachtet
          </p>
          <h2 className="font-heading text-3xl tracking-tight">
            Wellen messen. Muster prüfen.
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Retracements und Expansionen aus deinen Messungen. Vergleiche
            Wellen, Wellengrade und Märkte auf derselben Prozentbasis.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={download}
            disabled={!filtered.length}
          >
            <Download data-icon="inline-start" />
            CSV
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
            disabled={!instruments.length}
          >
            <Plus data-icon="inline-start" />
            Beobachtung
          </Button>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Untersuchung eingrenzen</CardTitle>
          <CardDescription>
            Einheitliche Welle, Wellengrad und Zeiteinheit machen die Fälle
            besser vergleichbar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {!stockId && (
              <Choice
                label="Instrument"
                value={String(filters.stockId || "")}
                onChange={(v) => set("stockId", v)}
                options={instruments.map((i) => ({
                  value: String(i.id),
                  label: `${i.ticker} · ${i.name}`,
                }))}
              />
            )}
            <Choice
              label="Messart"
              all={false}
              value={filters.measurementKind || "retracement"}
              onChange={(v) => set("measurementKind", v)}
              options={[
                { value: "retracement", label: "Retracement" },
                { value: "expansion", label: "Expansion" },
              ]}
            />
            <Choice
              label="Status"
              value={filters.status || ""}
              onChange={(v) => set("status", v)}
              options={choices([
                "laufend",
                "abgeschlossen",
                "unklar",
                "ungueltig",
              ])}
            />
            <Choice
              label="Anlageklasse"
              value={filters.market || ""}
              onChange={(v) => set("market", v)}
              options={Object.entries(marketNames).map(([value, label]) => ({
                value,
                label,
              }))}
            />
            <Choice
              label="Welle"
              value={filters.wave || ""}
              onChange={(v) => set("wave", v)}
              options={choices(waveLabels)}
            />
            <Choice
              label="Wellengrad"
              value={filters.degree || ""}
              onChange={(v) => set("degree", v)}
              options={choices(FIB_DEGREES)}
            />
            <Choice
              label="Zeiteinheit"
              value={filters.timeframe || ""}
              onChange={(v) => set("timeframe", v)}
              options={choices(FIB_TIMEFRAMES)}
            />
            <DateFilter
              label="Von"
              value={filters.from || ""}
              onChange={(v) => set("from", v)}
            />
            <DateFilter
              label="Bis"
              value={filters.to || ""}
              onChange={(v) => set("to", v)}
            />
            <div className="flex items-end">
              <Button
                variant="ghost"
                onClick={() => {
                  setFilters({ stockId, measurementKind: "retracement" });
                  setPage(0);
                }}
              >
                Filter zurücksetzen
              </Button>
            </div>
          </FieldGroup>
          {filters.from && filters.to && filters.from > filters.to && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              Der Beginn liegt nach dem Ende. Bitte Zeitraum korrigieren.
            </p>
          )}
        </CardContent>
      </Card>
      <ResearchMetricSummary metrics={metrics} />
      <p className="text-xs text-muted-foreground">
        Trade-Kennzahlen: eindeutig verknüpfte abgeschlossene Trades der
        gefilterten abgeschlossenen Wellen, jeder Trade einmal. Hypothetische
        Angaben bleiben davon getrennt.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          [
            "Abgeschlossene Wellen",
            String(stats.n),
            `${stats.running} laufend · ${stats.unclear} unklar · ${stats.invalid} ungültig · ${stats.missing} ohne Messwert`,
          ],
          [
            "Durchschnitt",
            `${fmt(stats.mean)} %`,
            "Arithmetischer Mittelwert der Tiefe",
          ],
          [
            "Median",
            `${fmt(stats.median)} %`,
            stats.n
              ? `Mittlere 50 %: ${fmt(stats.q1)}–${fmt(stats.q3)} %`
              : "Robuster Mittelpunkt der Stichprobe",
          ],
          [
            "Häufigste Endzone",
            stats.modes.length === 1
              ? `${fmt(stats.modes[0])} %`
              : stats.modes.length
                ? "Gleichstand"
                : "—",
            stats.modes.length > 1
              ? stats.modes.map(fmt).join(" / ") + " %"
              : "Zuordnung zur nächsten Fibonacci-Marke",
          ],
        ].map(([label, value, description]) => (
          <Card key={label}>
            <CardContent className="pt-5">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-2 break-words font-mono text-2xl tracking-tight">
                {value}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <nav
        aria-label="Wellendetails"
        className="grid grid-cols-2 gap-3 md:grid-cols-5"
      >
        {waveLabels.map((wave) => {
          const s = fibStats(
            filterFib(observations, { ...filters, wave }),
            filters.measurementKind,
          );
          return (
            <Button
              key={wave}
              variant={filters.wave === wave ? "default" : "outline"}
              className="h-auto min-w-0 flex-col items-start gap-1 whitespace-normal p-4 text-left"
              onClick={() => set("wave", wave)}
            >
              <span className="text-lg">Welle {wave}</span>
              <span className="text-xs">
                n={s.n} · Median {fmt(s.median)} %
              </span>
            </Button>
          );
        })}
      </nav>
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={stats.exploratory ? "outline" : "secondary"}>
          {stats.exploratory
            ? "Explorativ · weniger als 10 Fälle"
            : `${stats.n} abgeschlossene Beobachtungen`}
        </Badge>
        Beschreibt deine erfasste Auswahl. Keine Prognose; auch mehr Fälle
        garantieren keine repräsentative Stichprobe.
      </p>
      {!stats.n ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Waves className="size-8 text-primary" />
            <h3 className="font-heading text-xl">
              Noch keine abgeschlossene Messung
            </h3>
            <p className="max-w-md text-sm text-muted-foreground">
              {filtered.length
                ? "Laufende und ungültige Wellen zählen nicht zur Verteilung. Schließe eine beobachtete Welle ab oder passe die Filter an."
                : "Erfasse eine Welle mit ihrer tatsächlich beobachteten Tiefe. Alte Trade-Ziele werden nicht als Messwerte übernommen."}
            </p>
            <Button
              variant="outline"
              disabled={!instruments.length}
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              {instruments.length
                ? "Erste Messung erfassen"
                : "Zuerst ein Instrument anlegen"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Wo endete das Retracement?</CardTitle>
                <CardDescription>
                  Jede abgeschlossene Welle zählt genau einmal in ihre nächste
                  Endzone.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3">
                  {stats.zones.map((z) => (
                    <div
                      key={z.level}
                      className="grid grid-cols-[4.5rem_1fr_5rem] items-center gap-2"
                    >
                      <span className="font-mono text-xs">
                        {fmt(z.level)} %
                      </span>
                      <div
                        className="h-6 overflow-hidden rounded bg-muted"
                        title={`${fmt(z.lower)} bis ${fmt(z.upper)} % · ${z.count} Fälle`}
                      >
                        <div
                          className="h-full rounded bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                          style={{ width: `${(z.count / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className="whitespace-nowrap text-right font-mono text-xs">
                        {z.count} · {fmt((z.count / stats.n) * 100)} %
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-5 text-xs text-muted-foreground">
                  Zonengrenzen liegen mittig zwischen den Marken. Exakte Tiefen
                  stehen unten. 50 % ist eine gebräuchliche Referenzmarke.
                  Überläufe über 100 % bleiben enthalten.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Welche Schwelle wurde erreicht?</CardTitle>
                <CardDescription>
                  Anteil abgeschlossener Wellen mit einer Tiefe mindestens auf
                  diesem Niveau.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3">
                  {stats.zones
                    .filter((z) => z.level > 0)
                    .map((z) => (
                      <div
                        key={z.level}
                        className="grid grid-cols-[4.5rem_1fr_5rem] items-center gap-2"
                      >
                        <span className="font-mono text-xs">
                          ≥ {fmt(z.level)} %
                        </span>
                        <div className="h-6 rounded bg-muted">
                          <div
                            className="h-full rounded bg-chart-2 transition-[width] duration-500 motion-reduce:transition-none"
                            style={{ width: `${(z.reached / stats.n) * 100}%` }}
                          />
                        </div>
                        <span className="whitespace-nowrap text-right font-mono text-xs">
                          {fmt((z.reached / stats.n) * 100)} %
                        </span>
                      </div>
                    ))}
                </div>
                <p className="mt-5 text-xs text-muted-foreground">
                  Eine tiefe Welle erreicht mehrere Schwellen. Die Anteile
                  addieren sich deshalb nicht zu 100 %. Das misst Tiefe, keine
                  punktgenaue Kursberührung.
                </p>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Welle × Endzone</CardTitle>
              <CardDescription>
                Wo häufen sich die beobachteten Endpunkte? Intensität gilt
                innerhalb jeder Wellenzeile.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-separate border-spacing-1 text-xs">
                <caption className="sr-only">
                  Anzahl abgeschlossener Wellen je Fibonacci-Endzone
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="text-left">
                      Welle
                    </th>
                    {FIB_LEVELS.map((l) => (
                      <th key={l} scope="col" className="font-mono font-normal">
                        {fmt(l)} %
                      </th>
                    ))}
                    <th scope="col">n</th>
                    <th scope="col">Median</th>
                  </tr>
                </thead>
                <tbody>
                  {waves.map(({ wave, stats: s }) => (
                    <tr key={wave}>
                      <th scope="row" className="text-left">
                        {wave}
                      </th>
                      {s.zones.map((z) => (
                        <td
                          key={z.level}
                          title={`${wave}: ${z.count} von ${s.n} Fällen in Zone ${fmt(z.level)} %`}
                          className={cn(
                            "rounded p-2 text-center font-mono",
                            z.count ? "bg-primary/15" : "bg-muted/40",
                          )}
                          style={
                            z.count
                              ? {
                                  backgroundColor: `color-mix(in oklab, var(--primary) ${15 + (65 * z.count) / Math.max(1, ...s.zones.map((c) => c.count))}%, var(--card))`,
                                }
                              : undefined
                          }
                        >
                          {z.count || "—"}
                        </td>
                      ))}
                      <td className="text-center">{s.n}</td>
                      <td className="text-right font-mono">
                        {fmt(s.median)} %
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          {!stockId && groups.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Instrumente im Vergleich</CardTitle>
                <CardDescription>
                  Nach Stichprobengröße sortiert. Filter oben gelten auch hier.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[500px] text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th scope="col" className="pb-3">
                          Instrument
                        </th>
                        <th scope="col">Fälle</th>
                        <th scope="col">Ø Tiefe</th>
                        <th scope="col">Median</th>
                        <th scope="col">Häufigste Zone</th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.map(({ instrument: i, stats: s }) => (
                        <tr key={i.id} className="border-t border-border">
                          <th
                            scope="row"
                            className="py-3 text-left font-normal"
                          >
                            <button
                              type="button"
                              className="text-primary underline-offset-4 hover:underline"
                              onClick={() => set("stockId", String(i.id))}
                            >
                              {i.ticker}
                            </button>
                            <p className="text-xs text-muted-foreground">
                              {i.name} · {marketNames[i.market] || i.market}
                            </p>
                          </th>
                          <td>
                            {s.n}
                            {s.exploratory ? " *" : ""}
                          </td>
                          <td className="font-mono">{fmt(s.mean)} %</td>
                          <td className="font-mono">{fmt(s.median)} %</td>
                          <td className="font-mono">
                            {s.modes.length > 1
                              ? "Gleichstand"
                              : fmt(s.modes[0]) + " %"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  * Weniger als zehn abgeschlossene Fälle.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Messprotokoll</CardTitle>
          <CardDescription>
            {filtered.length} passende Beobachtungen · Quelle, Status und
            exakter Wert bleiben prüfbar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!filtered.length ? (
            <p className="text-sm text-muted-foreground">
              Keine Beobachtungen für diese Auswahl.
            </p>
          ) : (
            <>
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[650px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th scope="col" className="pb-3">
                        Instrument / Datum
                      </th>
                      <th scope="col">Welle / Grad</th>
                      <th scope="col">Tiefe</th>
                      <th scope="col">Status / Messnotiz</th>
                      <th scope="col">
                        <span className="sr-only">Bearbeiten</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <th scope="row" className="py-3 text-left font-normal">
                          {r.ticker}
                          <p className="text-xs text-muted-foreground">
                            {r.observedOn} · {r.timeframe} · Version {r.version}
                          </p>
                        </th>
                        <td>
                          {r.wave}
                          <p className="text-xs text-muted-foreground">
                            {r.degree}
                          </p>
                        </td>
                        <td className="font-mono">
                          {fmt(r.percent)} %
                          <p className="text-xs text-muted-foreground">
                            {r.measurementKind || "retracement"}
                          </p>
                          {r.anchorStart !== null && (
                            <p className="text-[10px] text-muted-foreground">
                              {fmt(r.anchorStart)} → {fmt(r.anchorEnd)}
                              <br />
                              Extrem {fmt(r.extreme)}
                            </p>
                          )}
                        </td>
                        <td className="max-w-xs">
                          <Badge variant="outline">
                            {r.status === "ungueltig"
                              ? "Ungültig"
                              : r.status === "laufend"
                                ? "Laufend"
                                : r.status === "unklar"
                                  ? "Unklar"
                                  : "Abgeschlossen"}
                          </Badge>
                          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                            {r.note}
                            {[
                              r.measurementBasis,
                              r.structure,
                              r.stopDescription,
                              r.sourceRef,
                              r.periodFrom &&
                                `${r.periodFrom}–${r.periodTo || "offen"}`,
                              r.tradeId && `Trade ${r.tradeId}`,
                              r.historyId && `Kursdaten ${r.historyId}`,
                              `Handelbarkeit: ${r.tradability || "unbekannt"}`,
                              `Hypothese: ${r.hypotheticalOutcome || "unbekannt"}`,
                              `Tatsächlich (Nutzerangabe): ${r.actualOutcome || "unbekannt"}`,
                            ]
                              .filter(Boolean)
                              .map((v, i) => (
                                <span className="block" key={i}>
                                  {v}
                                </span>
                              ))}
                          </p>
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Messung ${r.ticker} ${r.observedOn} bearbeiten`}
                            onClick={() => {
                              setEditing(r);
                              setOpen(true);
                            }}
                          >
                            <Pencil />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {currentPage * 20 + 1}–
                  {Math.min((currentPage + 1) * 20, filtered.length)} von{" "}
                  {filtered.length}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Zurück
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(currentPage + 1) * 20 >= filtered.length}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Weiter
                    <ArrowRight data-icon="inline-end" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-3 md:grid-cols-2">
        {[
          ["Strukturen", stats.structures],
          ["Stopbeschreibungen", stats.stops],
        ].map(([title, raw]) => {
          const f = raw as typeof stats.structures;
          return (
            <Card key={String(title)}>
              <CardHeader>
                <CardTitle>{String(title)}</CardTitle>
                <CardDescription>
                  n={f.n} · {f.missing} ohne Angabe · abgeschlossene gemessene
                  Wellen
                </CardDescription>
              </CardHeader>
              <CardContent>
                {f.items.length ? (
                  f.items.map((item) => (
                    <p key={item.label} className="text-sm">
                      {item.label}: {item.count} ({fmt(item.percent)} %)
                    </p>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Keine Angaben für diese Auswahl.
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Stopvarianten im Vergleich</CardTitle>
          <CardDescription>
            Dokumentierte Nutzereinschätzungen, getrennt nach tatsächlichem und
            hypothetischem Verlauf. Keine Simulation; keine automatische
            Handelsregel.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {stats.stopVariants.length ? (
            stats.stopVariants.map((v, i) => (
              <div key={i} className="border-t border-border pt-3 text-sm">
                <p>
                  {v.label} ·{" "}
                  {v.kind === "tatsaechlich" ? "Tatsächlich" : "Hypothetisch"} ·
                  n={v.n}
                </p>
                <p className="text-xs text-muted-foreground">{v.description}</p>
                <p className="font-mono text-xs">
                  {Object.entries(v.outcomes)
                    .map(([k, n]) => `${k}: ${n}`)
                    .join(" · ")}{" "}
                  · Ø R {fmt(v.averageR)} (n={v.rCount})
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              Noch keine dokumentierten Varianten in dieser Auswahl.
            </p>
          )}
        </CardContent>
      </Card>
      <FibonacciHistoryPanel
        key={stockId || filters.stockId || "all"}
        stockId={stockId || filters.stockId}
        histories={histories}
      />
      <details className="rounded-lg border border-border p-4 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">
          Messdefinition & Grenzen
        </summary>
        <div className="mt-3 flex flex-col gap-2">
          <p>
            Referenzbewegung: Anfang → Ende. Die Korrektur beginnt am Ende.
            Tiefe = (Ende − beobachtetes Extrem) / (Ende − Anfang) × 100. Beide
            Richtungen sind unterstützt. Alle drei Preise müssen dieselbe
            Währung und Kursskala verwenden.
          </p>
          <p>
            Erfasse die maximale Tiefe einer konkreten Welle genau einmal pro
            Wellengrad und Zeitraum. Bei einem neuen Extrem die bestehende
            Messung korrigieren. „Abgeschlossen“ ist deine bestätigte
            Einordnung, keine automatische Elliott-Erkennung.
          </p>
          <p>
            „Übergeordnet“ bedeutet hier: Gesamtstatistik über Instrumente und
            Filter nach Wellengrad. Fälle desselben Instruments oder
            verschachtelter Wellen können abhängig sein. Häufigste Zone und
            Durchschnitt sind deskriptiv; selektive Erfassung kann sie
            verzerren.
          </p>
          <p>
            Quartile nutzen lineare Interpolation zwischen sortierten Werten.
            Ungültige und laufende Beobachtungen bleiben im Protokoll, sind aus
            der abgeschlossenen Statistik ausgeschlossen. Kein automatischer
            Backfill.
          </p>
        </div>
      </details>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? "Beobachtung korrigieren"
                : "Fibonacci-Beobachtung erfassen"}
            </DialogTitle>
            <DialogDescription>
              Eine konkrete Welle, ihre Referenzbewegung und das beobachtete
              Extrem. Planwerte gehören nicht in diese Messung.
            </DialogDescription>
          </DialogHeader>
          {open && (
            <FibForm
              key={editing?.id || "new"}
              instruments={instruments}
              stockId={stockId || filters.stockId}
              existing={editing}
              close={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
function FibForm({
  instruments,
  stockId,
  existing,
  close,
}: {
  instruments: Instrument[];
  stockId?: number;
  existing: FibObservation | null;
  close: () => void;
}) {
  const router = useRouter(),
    prefix = useId(),
    [pending, startTransition] = useTransition(),
    [error, setError] = useState(""),
    [id] = useState(() => existing?.id || crypto.randomUUID());
  const [stopVariants, setStopVariants] = useState(
    existing?.stopVariants ?? [],
  );
  const [form, setForm] = useState({
    stockId: String(existing?.stockId || stockId || instruments[0]?.id || ""),
    wave: existing?.wave || "B",
    degree: existing?.degree || "unbekannt",
    timeframe: existing?.timeframe || "unbekannt",
    observedOn: existing?.observedOn || new Date().toISOString().slice(0, 10),
    status: existing?.status || "laufend",
    mode: existing?.anchorStart != null ? "anchors" : "direct",
    percent: existing?.percent != null ? String(existing.percent) : "",
    measurementKind: existing?.measurementKind || "retracement",
    measurementBasis: existing?.measurementBasis || "",
    structure: existing?.structure || "",
    target: existing?.target != null ? String(existing.target) : "",
    stopDescription: existing?.stopDescription || "",
    sourceRef: existing?.sourceRef || "",
    sourceKey: existing?.sourceKey || "",
    periodFrom: existing?.periodFrom || "",
    periodTo: existing?.periodTo || "",
    tradeId: existing?.tradeId ? String(existing.tradeId) : "",
    historyId: existing?.historyId || "",
    contextId: existing?.contextId || "",
    tradability: existing?.tradability || "unbekannt",
    hypotheticalOutcome: existing?.hypotheticalOutcome || "unbekannt",
    actualOutcome: existing?.actualOutcome || "unbekannt",
    anchorStart:
      existing?.anchorStart != null ? String(existing.anchorStart) : "",
    anchorEnd: existing?.anchorEnd != null ? String(existing.anchorEnd) : "",
    extreme: existing?.extreme != null ? String(existing.extreme) : "",
    note: existing?.note || "",
  });
  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  let preview: number | null = null;
  if (
    form.mode === "anchors" &&
    form.anchorStart &&
    form.anchorEnd &&
    form.extreme
  ) {
    try {
      preview = retracement(
        Number(form.anchorStart),
        Number(form.anchorEnd),
        Number(form.extreme),
      );
    } catch {}
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      try {
        const anchored = form.mode === "anchors";
        const result = await saveFibonacci(
          id,
          {
            stockId: Number(form.stockId),
            wave: form.wave,
            degree: form.degree,
            timeframe: form.timeframe,
            observedOn: form.observedOn,
            status: form.status,
            percent:
              anchored || form.percent === "" ? null : Number(form.percent),
            anchorStart: anchored ? Number(form.anchorStart) : null,
            anchorEnd: anchored ? Number(form.anchorEnd) : null,
            extreme: anchored ? Number(form.extreme) : null,
            note: form.note,
            stopVariants,
            measurementKind: form.measurementKind,
            measurementBasis: form.measurementBasis || null,
            structure: form.structure || null,
            target: form.target ? Number(form.target) : null,
            stopDescription: form.stopDescription || null,
            sourceRef: form.sourceRef || null,
            sourceKey: form.sourceKey || null,
            periodFrom: form.periodFrom || null,
            periodTo: form.periodTo || null,
            tradeId: form.tradeId ? Number(form.tradeId) : null,
            historyId: form.historyId || null,
            contextId: form.contextId || null,
            tradability: form.tradability,
            hypotheticalOutcome: form.hypotheticalOutcome,
            actualOutcome: form.actualOutcome,
          },
          existing?.version,
        );
        if (!result.ok) {
          setError(result.error);
          router.refresh();
          return;
        }
        toast.success("Beobachtung gespeichert und zurückgelesen.");
        router.refresh();
        close();
      } catch {
        setError(
          "Speicherung nicht bestätigt. Bitte erneut versuchen; dieselbe Erfassungs-ID verhindert Duplikate.",
        );
      }
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <fieldset disabled={pending} className="flex flex-col gap-4">
        <FieldGroup className="grid grid-cols-2 gap-3">
          <Choice
            all={false}
            label="Instrument"
            value={form.stockId}
            onChange={(v) => set("stockId", v)}
            options={instruments.map((i) => ({
              value: String(i.id),
              label: `${i.ticker} · ${i.name}`,
            }))}
          />
          <Field>
            <FieldLabel htmlFor={prefix + "wave"}>
              Welle / eigenes Label
            </FieldLabel>
            <Input
              id={prefix + "wave"}
              value={form.wave}
              required
              maxLength={40}
              onChange={(e) => set("wave", e.target.value)}
            />
          </Field>
          <Choice
            all={false}
            label="Wellengrad"
            value={form.degree}
            onChange={(v) => set("degree", v)}
            options={choices(FIB_DEGREES)}
          />
          <Choice
            all={false}
            label="Zeiteinheit"
            value={form.timeframe}
            onChange={(v) => set("timeframe", v)}
            options={choices(FIB_TIMEFRAMES)}
          />
          <DateFilter
            label="Beobachtungsdatum"
            value={form.observedOn}
            onChange={(v) => set("observedOn", v)}
          />
          <Choice
            all={false}
            label="Wellenstatus"
            value={form.status}
            onChange={(v) => set("status", v)}
            options={[
              { value: "laufend", label: "Laufend" },
              { value: "abgeschlossen", label: "Abgeschlossen" },
              { value: "unklar", label: "Unklar" },
              { value: "ungueltig", label: "Ungültig" },
            ]}
          />
        </FieldGroup>
        <Choice
          all={false}
          label="Messart"
          value={form.measurementKind}
          options={[
            { value: "retracement", label: "Retracement" },
            { value: "expansion", label: "Expansion" },
          ]}
          onChange={(v) =>
            setForm((f) => ({
              ...f,
              measurementKind: v as "retracement" | "expansion",
              mode: "direct",
              anchorStart: "",
              anchorEnd: "",
              extreme: "",
            }))
          }
        />
        <Choice
          all={false}
          label="Messmethode"
          value={form.mode}
          onChange={(v) => set("mode", v)}
          options={[
            { value: "direct", label: "Tiefe direkt in Prozent" },
            ...(form.measurementKind === "retracement"
              ? [{ value: "anchors", label: "Aus Referenzankern berechnen" }]
              : []),
          ]}
        />
        <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(form.mode === "anchors"
            ? [
                ["anchorStart", "Anfang der Referenz"],
                ["anchorEnd", "Ende der Referenz"],
                ["extreme", "Beobachtetes Extrem"],
              ]
            : [
                [
                  "percent",
                  form.measurementKind === "expansion"
                    ? "Expansion in %"
                    : "Retracement in %",
                ],
              ]
          ).map(([key, label]) => (
            <Field key={key}>
              <FieldLabel htmlFor={prefix + key}>{label}</FieldLabel>
              <Input
                id={prefix + key}
                type="number"
                step="any"
                min={key === "percent" ? 0 : 0.00000001}
                max={
                  key === "percent" && form.measurementKind === "retracement"
                    ? 500
                    : undefined
                }
                required={form.mode === "anchors"}
                value={form[key as keyof typeof form]}
                onChange={(e) => set(key as keyof typeof form, e.target.value)}
                aria-invalid={!!error}
              />
            </Field>
          ))}
        </FieldGroup>
        {form.mode === "anchors" && (
          <p className="rounded-lg bg-muted p-3 font-mono text-sm">
            Berechnete Tiefe: <strong>{fmt(preview)} %</strong>
            <span className="mt-1 block font-sans text-xs text-muted-foreground">
              Chronologisch Anfang → Ende; Korrekturextrem danach. Gleiche
              Währung und Kursskala.
            </span>
          </p>
        )}
        <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(
            [
              ["measurementBasis", "Bezugsbasis (bei Expansion erforderlich)"],
              ["structure", "Struktur / Korrekturtyp"],
              ["target", "Kursziel"],
              ["stopDescription", "Stop relativ zu Box / Trendwendebereich"],
              ["sourceRef", "Quelle / Referenz"],
              ["sourceKey", "Stabile Quellenkennung (optional)"],
              ["periodFrom", "Zeitraum von"],
              ["periodTo", "Zeitraum bis"],
              ["tradeId", "Trade-ID (optional)"],
              ["historyId", "Kursdatensatz-ID (optional)"],
              ["contextId", "Wellenkontext-ID (optional)"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key}>
              <FieldLabel htmlFor={prefix + key}>{label}</FieldLabel>
              <Input
                id={prefix + key}
                value={form[key]}
                required={
                  key === "measurementBasis" &&
                  form.measurementKind === "expansion"
                }
                type={
                  key === "periodFrom" || key === "periodTo"
                    ? "date"
                    : key === "target" || key === "tradeId"
                      ? "number"
                      : "text"
                }
                step="any"
                onChange={(e) => set(key, e.target.value)}
              />
            </Field>
          ))}
        </FieldGroup>
        <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Choice
            all={false}
            label="Handelbarkeit (vorläufig)"
            value={form.tradability}
            onChange={(v) => set("tradability", v)}
            options={choices(["unbekannt", "handelbar", "nicht_handelbar"])}
          />
          {(["hypotheticalOutcome", "actualOutcome"] as const).map((key) => (
            <Choice
              key={key}
              all={false}
              label={
                key === "hypotheticalOutcome"
                  ? "Hypothetischer Ausgang"
                  : "Tatsächlicher Ausgang (Nutzerangabe)"
              }
              value={form[key]}
              onChange={(v) => set(key, v)}
              options={choices([
                "unbekannt",
                "gewinn",
                "verlust",
                "breakeven",
                "ausgelassen",
              ])}
            />
          ))}
        </FieldGroup>
        <StopVariantsEditor value={stopVariants} onChange={setStopVariants} />
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor={prefix + "note"}>Messnotiz / Quelle</FieldLabel>
          <Textarea
            id={prefix + "note"}
            required
            maxLength={2000}
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="Welche Welle und welcher Zeitraum? Quelle, Referenzpunkte, Abschlusskriterium …"
            aria-invalid={!!error}
          />
          <FieldDescription>
            Unterscheidet die konkrete Welle von früheren Fällen. Bei Änderungen
            am Extrem diese Beobachtung korrigieren.
          </FieldDescription>
        </Field>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={close}
          disabled={pending}
        >
          Abbrechen
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Wird gespeichert …" : "Speichern"}
        </Button>
      </div>
    </form>
  );
}
