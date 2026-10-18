"use client";
import { TradeAnalysis } from "@/components/trade-analysis";
import { fibonacciReadModel } from "@/lib/fibonacci-read-model";
import { ResearchDataGroups } from "@/components/research-data-groups";
import { useMemo, useState, useTransition, useId } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Download,
  Plus,
  Waves,
  ArrowRight,
  SlidersHorizontal,
  Search,
} from "lucide-react";
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
import { type TradeResearchRow } from "@/lib/trade-research-coverage";
import { EvidenceEditor } from "@/components/fibonacci-evidence";
import { ResidenceEditor } from "@/components/fibonacci-residence";
import type { FibEvidence } from "@/lib/fibonacci";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FibonacciObservationList } from "@/components/fibonacci-observation-list";
import {
  selectResearchRows,
  orderResearchRows,
  formatResearchPercent,
  type ResearchSelection,
  type ResearchOrder,
} from "@/lib/fibonacci-workspace";
type Instrument = { id: number; name: string; ticker: string; market: string };
type Props = {
  tradeCoverage?: TradeResearchRow[];
  observations: FibObservation[];
  instruments: Instrument[];
  stockId?: number;
  samples?: MetricSample[];
  histories?: HistorySummary[];
};
const fmt = (n: number | null | undefined) =>
  n == null
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
  tradeCoverage = [],
}: Props) {
  const searchId = useId();
  const [filters, setFilters] = useState<FibFilters>({
      stockId,
      measurementKind: "retracement",
    }),
    [editing, setEditing] = useState<FibObservation | null>(null),
    [open, setOpen] = useState(false),
    [page, setPage] = useState(0),
    [search, setSearch] = useState(""),
    [selection, setSelection] = useState<ResearchSelection>("all"),
    [order, setOrder] = useState<ResearchOrder>("newest"),
    [tab, setTab] = useState("protocol");
  const filtered = useMemo(
      () => selectResearchRows(observations, filters, search, selection),
      [observations, filters, search, selection],
    ),
    stats = useMemo(
      () => fibStats(filtered, filters.measurementKind),
      [filtered, filters.measurementKind],
    );
  const waveLabels = [
    ...new Set([...FIB_WAVES, ...observations.map((r) => r.wave)]),
  ];
  const readModel = useMemo(()=>fibonacciReadModel(filtered,tradeCoverage,samples,filters.stockId),[filtered,tradeCoverage,samples,filters.stockId]);
  const metrics = readModel.metrics;
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
    .filter((g) => g.stats.coverage.total > 0)
    .sort((a, b) => b.stats.n - a.stats.n);
  const maxCount = Math.max(1, ...stats.zones.map((z) => z.count));
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 20) - 1),
  );
  const sorted = useMemo(
    () => orderResearchRows(filtered, order),
    [filtered, order],
  );
  const shown = sorted.slice(currentPage * 20, (currentPage + 1) * 20);
  const missing = filtered.filter((row) => row.percent == null).length;
  const advancedCount = [
    filters.status,
    filters.market,
    filters.degree,
    filters.from,
    filters.to,
  ].filter(Boolean).length;
  const reset = () => {
    setFilters({ stockId, measurementKind: "retracement" });
    setSearch("");
    setSelection("all");
    setPage(0);
  };
  const create = () => {
    setEditing(null);
    setOpen(true);
  };
  const edit = (row: FibObservation) => {
    setEditing(row);
    setOpen(true);
  };
  const percent = formatResearchPercent;
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
      className="flex min-w-0 scroll-mt-36 flex-col gap-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div className="min-w-0">
          <p className="eyebrow mb-2">Wellenforschung · dein Messbestand</p>
          <h2 className="font-heading text-3xl tracking-tight">
            Messen. Wiederfinden. Vergleichen.
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Eine konkrete Welle pro Beobachtung. Exakte Werte, Quelle und offene
            Angaben bleiben zusammen.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={download}
            disabled={!filtered.length}
          >
            <Download data-icon="inline-start" />
            CSV der Auswahl
          </Button>
          <Button onClick={create} disabled={!instruments.length}>
            <Plus data-icon="inline-start" />
            Neue Beobachtung
          </Button>
        </div>
      </div>

      <div
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        aria-label="Datenbasis der aktuellen Auswahl"
        aria-live="polite"
        aria-atomic="true"
      >
        {[
          [
            "Beobachtungen",
            String(filtered.length),
            "In der aktuellen Auswahl",
          ],
          [
            "Exakte Prozentmessungen",
            String(stats.n),
            `${stats.running} laufend · ${stats.unclear} unklar · ${stats.invalid} ungültig`,
          ],
          [
            "Median",
            percent(stats.median),
            stats.n
              ? `Mittlere 50 %: ${fmt(stats.q1)}–${fmt(stats.q3)} %`
              : "Exakte abgeschlossene Werte fehlen",
          ],
          [
            "Ohne Messwert",
            String(missing),
            `${stats.missing} davon abgeschlossen · beschreibend nutzbar`,
          ],
        ].map(([label, value, description]) => (
          <Card className="panel" key={label}>
            <CardHeader className="pb-0">
              <CardDescription>{label}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="break-words font-mono text-3xl tracking-tight">
                {value}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="panel">
        <CardHeader className="pb-0">
          <CardTitle>Deine Untersuchung</CardTitle>
          <CardDescription>
            Suche und Filter gelten für Protokoll, Kennzahlen, Vergleiche und
            CSV.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem]">
            <Field>
              <FieldLabel htmlFor={searchId}>
                <Search className="size-3.5" />
                Beobachtungen durchsuchen
              </FieldLabel>
              <Input
                id={searchId}
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Instrument, Welle, Quelle oder Messnotiz …"
              />
            </Field>
            <Choice
              label="Arbeitsauswahl"
              all={false}
              value={selection}
              onChange={(v) => {
                setSelection(v as ResearchSelection);
                setPage(0);
              }}
              options={[
                { value: "all", label: "Alle Beobachtungen" },
                { value: "missing", label: "Ohne Messwert" },
                { value: "running", label: "Laufende Wellen" },
                { value: "completed", label: "Abgeschlossene Wellen" },
              ]}
            />
          </FieldGroup>
          <FieldGroup className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
              label="Welle"
              value={filters.wave || ""}
              onChange={(v) => set("wave", v)}
              options={choices(waveLabels)}
            />
            <Choice
              label="Zeiteinheit"
              value={filters.timeframe || ""}
              onChange={(v) => set("timeframe", v)}
              options={choices(FIB_TIMEFRAMES)}
            />
          </FieldGroup>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <details
              className="min-w-0 flex-1"
              open={advancedCount > 0 || undefined}
            >
              <summary className="w-fit cursor-pointer text-sm text-muted-foreground marker:text-primary">
                <span className="inline-flex items-center gap-2">
                  <SlidersHorizontal className="size-3.5" />
                  Weitere Filter
                  {advancedCount > 0 ? ` · ${advancedCount} aktiv` : ""}
                </span>
              </summary>
              <FieldGroup className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
                <Choice
                  label="Wellengrad"
                  value={filters.degree || ""}
                  onChange={(v) => set("degree", v)}
                  options={choices(FIB_DEGREES)}
                />
                <Choice
                  label="Status"
                  value={filters.status || ""}
                  onChange={(v) => set("status", v)}
                  options={[
                    { value: "laufend", label: "Laufend" },
                    { value: "abgeschlossen", label: "Abgeschlossen" },
                    { value: "unklar", label: "Unklar" },
                    { value: "ungueltig", label: "Ungültig" },
                  ]}
                />
                <Choice
                  label="Anlageklasse"
                  value={filters.market || ""}
                  onChange={(v) => set("market", v)}
                  options={Object.entries(marketNames).map(
                    ([value, label]) => ({ value, label }),
                  )}
                />
                <DateFilter
                  label="Erfasst von"
                  value={filters.from || ""}
                  onChange={(v) => set("from", v)}
                />
                <DateFilter
                  label="Erfasst bis"
                  value={filters.to || ""}
                  onChange={(v) => set("to", v)}
                />
              </FieldGroup>
            </details>
            <Button variant="ghost" size="sm" onClick={reset}>
              Auswahl zurücksetzen
            </Button>
          </div>
          {filters.from && filters.to && filters.from > filters.to && (
            <p role="alert" className="text-sm text-destructive">
              Der Beginn liegt nach dem Ende. Bitte Zeitraum korrigieren.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <p>
          <Badge variant={stats.exploratory ? "outline" : "secondary"}>
            {stats.exploratory
              ? "Explorative Auswahl"
              : `${stats.n} exakte Messungen`}
          </Badge>
          <span className="ml-2">
            {filters.measurementKind === "expansion"
              ? "Expansion"
              : "Retracement"}{" "}
            · nur abgeschlossene gültige Werte in der Verteilung
          </span>
        </p>
        <p>{observations.length} Beobachtungen insgesamt</p>
      </div>

      <Card><CardHeader><CardTitle>Abdeckung abgeschlossener Beobachtungen</CardTitle><CardDescription>{observations.length} insgesamt gespeichert · {stats.coverage.total} im aktuellen Filter · {stats.coverage.completed} abgeschlossen. Jede Abschlusskennzahl verwendet ihre eigene Datenbasis. Vorläufige Angaben stehen unter „Laufend &amp; Simulation“.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">
      {Object.entries(stats.coverage).filter(([,v])=>typeof v === "object" && v !== null && "definition" in v).map(([key,raw])=>{
        const m=raw as typeof stats.coverage.exact;
        const labels:Record<string,string>={stopDescription:"Stopbeschreibung",stopVariants:"Stopvarianten",targetZoneResidence:"Verweildauer in der Zielzone",residenceKind:"Genauigkeit der Verweildauer",touchAndGo:"Touch-and-Go / länger verweilt",approximateReached:"Ungefähr erreichte Levels",hypotheticalExitLevel:"Hypothetischer Ausstiegslevel",hypotheticalCRVBasis:"CRV-Bezugsziel",unassignedLevels:"Levels mit ungeklärter Messart",exact:"Exakte Prozentmessung",approximate:"Ungefähre Prozentmessung",reached:"Erreichte Levels",missed:"Verfehlte Levels",reversalZone:"Umkehrzone",targetZone:"Zielzone",direction:"Wellenrichtung",period:"Zeitraum",duration:"Wellendauer",reversalDuration:"Umkehrdauer",structure:"Struktur",basis:"Messbasis",hypotheticalCRV:"Hypothetisches CRV",tradability:"Handelbarkeit",hypotheticalOutcome:"Hypothetischer Ausgang",actualOutcome:"Tatsächlicher qualitativer Ausgang"};
        return <details key={key}><summary>{labels[key] ?? key}: {m.n} von {m.denominator}{m.average != null ? ` · Durchschnitt ${fmt(m.average)}` : ""}</summary><p className="text-sm text-muted-foreground">{m.definition}</p>{m.distribution.map(d=><p className="text-xs" key={d.value}>{d.value}: {d.count} Fälle · {fmt(d.share)} % von {m.n}</p>)}{m.included.map(r=><p className="break-words text-xs" key={r.id}>{r.id}: {JSON.stringify(r.value)}</p>)}{m.excluded.map(r=><p className="break-words text-xs text-muted-foreground" key={r.id}>{r.id}: {r.reason}</p>)}</details>;
      })}
      <details><summary>Vergleichbare exakte Verweildauern: {stats.coverage.residenceComparisons.groups.reduce((n,g)=>n+g.n,0)} von {stats.coverage.total}</summary>
        <p className="text-sm text-muted-foreground">Nur abgeschlossene Fälle mit exakter Dauer, bekannter Zeitbasis und identischer Messkonvention. Schätzungen und Grenzen bleiben außerhalb der Mittelwerte.</p>
        {stats.coverage.residenceComparisons.groups.map((g,i)=><div key={i} className="text-sm"><p>{g.timeBasis === "calendar" ? "Kalenderzeit" : "Handelszeit"} · {g.convention} · n={g.n} · Mittel {fmt(g.average)} / Median {fmt(g.median)} {g.unit === "hour" ? "Stunden" : g.unit === "day" ? "Tage" : "Minuten"}</p>{g.included.map(r=><p key={r.id} className="text-xs">{r.id}: {fmt(r.value)}</p>)}</div>)}
        {stats.coverage.residenceComparisons.excluded.map(r=><p key={r.id} className="text-xs text-muted-foreground">{r.id}: {r.reason}</p>)}
      </details>
      {stats.coverage.levelProfile.map(l=><p className="text-sm" key={l.level}>{l.level} %: {l.reached.length} erreicht · {l.missed.length} verfehlt · n={l.n}. Nur explizite Angaben zu diesem Level.</p>)}
      </CardContent></Card>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(String(value))}
        className="min-w-0 gap-5"
      >
        <div className="min-w-0 overflow-x-auto border-b border-border pb-2">
          <TabsList
            activateOnFocus
            variant="line"
            aria-label="Messarbeit und Auswertung"
            className="min-h-11 min-w-max gap-4"
          >
            <TabsTrigger value="protocol">
              Messprotokoll <Badge variant="secondary">{filtered.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="distribution">Verteilungen</TabsTrigger>
            <TabsTrigger value="context">Strukturen & Stops</TabsTrigger>
            <TabsTrigger value="data-groups">Laufend & Simulation</TabsTrigger>
            <TabsTrigger value="trades">Tradebezug</TabsTrigger>
            <TabsTrigger value="history">Kursdaten</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="protocol" className="min-w-0">
          <Card className="panel">
            <CardHeader className="flex flex-wrap items-start justify-between gap-4 sm:flex-row">
              <div>
                <CardTitle>Messprotokoll</CardTitle>
                <CardDescription className="mt-1">
                  Fälle wiederfinden, Quellen prüfen und bestehende Messungen
                  ergänzen.
                </CardDescription>
              </div>
              <div className="w-full sm:w-48">
                <Choice
                  label="Sortierung"
                  all={false}
                  value={order}
                  onChange={(v) => {
                    setOrder(v as ResearchOrder);
                    setPage(0);
                  }}
                  options={[
                    { value: "newest", label: "Neueste zuerst" },
                    { value: "oldest", label: "Älteste zuerst" },
                    { value: "deepest", label: "Höchster Messwert" },
                  ]}
                />
              </div>
            </CardHeader>
            <CardContent>
              {!filtered.length ? (
                <div className="flex flex-col items-start gap-3 py-8">
                  <Waves className="size-7 text-primary" />
                  <h3 className="font-heading text-xl">
                    {observations.length
                      ? "Keine passenden Beobachtungen"
                      : "Deine erste Welle beginnt hier"}
                  </h3>
                  <p className="max-w-lg text-sm text-muted-foreground">
                    {observations.length
                      ? "Die Kombination aus Suche und Filtern ergibt keine Fälle. Setze die Auswahl zurück oder passe einzelne Filter an."
                      : "Erfasse eine tatsächlich beobachtete Welle. Beschreibende Fälle sind auch ohne exakten Messwert möglich; fehlende Zahlen bleiben sichtbar."}
                  </p>
                  {observations.length ? (
                    <Button variant="outline" onClick={reset}>
                      Auswahl zurücksetzen
                    </Button>
                  ) : (
                    <Button onClick={create} disabled={!instruments.length}>
                      Neue Beobachtung
                    </Button>
                  )}
                  {!instruments.length && (
                    <p className="text-sm text-muted-foreground">
                      Lege zuerst ein Instrument über „Instrument hinzufügen“
                      an.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  <FibonacciObservationList rows={shown} onEdit={edit} />
                  <nav
                    aria-label="Seiten im Messprotokoll"
                    className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"
                  >
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
                  </nav>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent
          value="distribution"
          className="flex min-w-0 flex-col gap-5"
        >
          <div className="grid grid-cols-2 gap-3">
            <Card className="panel">
              <CardHeader>
                <CardDescription>Durchschnitt</CardDescription>
                <CardTitle className="font-mono text-2xl">
                  {percent(stats.mean)}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Arithmetischer Mittelwert · n={stats.n}
              </CardContent>
            </Card>
            <Card className="panel">
              <CardHeader>
                <CardDescription>Häufigste Endzone</CardDescription>
                <CardTitle className="font-mono text-2xl">
                  {stats.modes.length === 1
                    ? percent(stats.modes[0])
                    : stats.modes.length
                      ? "Gleichstand"
                      : "—"}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {stats.modes.length > 1
                  ? stats.modes.map(percent).join(" / ")
                  : "Zuordnung zur nächsten Fibonacci-Marke"}
              </CardContent>
            </Card>
          </div>
          {!stats.n ? (
            <Card className="panel">
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Waves className="size-8 text-primary" />
                <h3 className="font-heading text-xl">
                  Noch keine auswertbaren Messwerte
                </h3>
                <p className="max-w-md text-sm text-muted-foreground">
                  {stats.missing
                    ? `${stats.missing} abgeschlossene Beobachtungen haben noch keinen exakten Messwert. Levels, Zonen und qualitative Angaben werden unabhängig davon in der Abdeckung ausgewertet.`
                    : filtered.length
                      ? "Laufende, unklare und ungültige Wellen bleiben im Protokoll. Die Verteilung verwendet nur abgeschlossene gültige Messungen."
                      : "Keine Beobachtung passt zur Auswahl. Passe die Filter an oder erfasse einen neuen historischen Fall."}
                </p>
                <Button
                  variant="outline"
                  disabled={!instruments.length}
                  onClick={() => {
                    if (filtered.length) setTab("protocol");
                    else create();
                  }}
                >
                  {filtered.length
                    ? "Messprotokoll öffnen"
                    : "Neue Beobachtung"}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
                <Card className="panel">
                  <CardHeader>
                    <CardTitle>
                      {filters.measurementKind === "expansion"
                        ? "Wo endete die Expansion?"
                        : "Wo endete das Retracement?"}
                    </CardTitle>
                    <CardDescription>
                      Jede abgeschlossene Welle zählt genau einmal in ihre
                      nächste Endzone.
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
                              style={{
                                width: `${(z.count / maxCount) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="whitespace-nowrap text-right font-mono text-xs">
                            {z.count} · {fmt((z.count / stats.n) * 100)} %
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-5 text-xs text-muted-foreground">
                      Zonengrenzen liegen mittig zwischen den Marken. Exakte
                      Tiefen stehen unten. 50 % ist eine gebräuchliche
                      Referenzmarke. Überläufe über 100 % bleiben enthalten.
                    </p>
                  </CardContent>
                </Card>
                <Card className="panel">
                  <CardHeader>
                    <CardTitle>Welche Schwelle wurde erreicht?</CardTitle>
                    <CardDescription>
                      Anteil abgeschlossener Wellen mit einer Tiefe mindestens
                      auf diesem Niveau.
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
                                style={{
                                  width: `${(z.reached / stats.n) * 100}%`,
                                }}
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
                      addieren sich deshalb nicht zu 100 %. Das misst Tiefe,
                      keine punktgenaue Kursberührung.
                    </p>
                  </CardContent>
                </Card>
              </div>
              <Card className="panel">
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
                          <th
                            key={l}
                            scope="col"
                            className="font-mono font-normal"
                          >
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
                            {percent(s.median)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
              {!stockId && groups.length > 0 && (
                <Card className="panel">
                  <CardHeader>
                    <CardTitle>Instrumente im Vergleich</CardTitle>
                    <CardDescription>
                      Nach Stichprobengröße sortiert. Filter oben gelten auch
                      hier.
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
                              <td className="font-mono">{percent(s.median)}</td>
                              <td className="font-mono">
                                {s.modes.length > 1
                                  ? "Gleichstand"
                                  : percent(s.modes[0])}
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
          <p className="text-xs text-muted-foreground">
            Die Verteilung beschreibt deine erfasste Auswahl. Auch mehr Fälle
            garantieren keine repräsentative Stichprobe oder verlässliche
            Kursprognose.
          </p>
        </TabsContent>
        <TabsContent value="context" className="flex min-w-0 flex-col gap-5">
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ["Strukturen", stats.structures],
              ["Stopbeschreibungen", stats.stops],
            ].map(([title, raw]) => {
              const f = raw as typeof stats.structures;
              return (
                <Card className="panel" key={String(title)}>
                  <CardHeader>
                    <CardTitle>{String(title)}</CardTitle>
                    <CardDescription>
                      n={f.n} · {f.missing} ohne Angabe · abgeschlossene
                      gemessene Wellen
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
          <Card className="panel">
            <CardHeader>
              <CardTitle>Stopvarianten im Vergleich</CardTitle>
              <CardDescription>
                Dokumentierte Nutzereinschätzungen, getrennt nach tatsächlichem
                und hypothetischem Verlauf. Keine Simulation; keine automatische
                Handelsregel.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {stats.stopVariants.length ? (
                stats.stopVariants.map((v, i) => (
                  <div key={i} className="border-t border-border pt-3 text-sm">
                    <p>
                      {v.label} ·{" "}
                      {v.kind === "tatsaechlich"
                        ? "Tatsächlich"
                        : "Hypothetisch"}{" "}
                      · n={v.n}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {v.description}
                    </p>
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
        </TabsContent>
        <TabsContent value="data-groups" className="flex min-w-0 flex-col gap-4">
          <ResearchDataGroups model={readModel} />
        </TabsContent>
        <TabsContent value="trades" className="flex min-w-0 flex-col gap-4">
          <TradeAnalysis rows={tradeCoverage.filter(t => !filters.stockId || t.stockId === filters.stockId)} samples={samples.filter(t => !filters.stockId || t.stockId === filters.stockId)} instrumentFiltered={!!filters.stockId} />
          <p>Separat: eindeutig mit gefilterten Wellen verknüpfte Trades</p>
          <ResearchMetricSummary metrics={metrics} />
        </TabsContent>
        <TabsContent value="history" className="min-w-0">
          <FibonacciHistoryPanel
            key={stockId || filters.stockId || "all"}
            stockId={stockId || filters.stockId}
            histories={histories}
          />
        </TabsContent>
      </Tabs>
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
        <DialogContent className="flex max-h-[90svh] flex-col overflow-hidden sm:max-w-2xl">
          <DialogHeader className="shrink-0">
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
              defaults={filters}
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
  defaults,
  close,
}: {
  instruments: Instrument[];
  stockId?: number;
  existing: FibObservation | null;
  defaults: FibFilters;
  close: () => void;
}) {
  const router = useRouter(),
    prefix = useId(),
    [pending, startTransition] = useTransition(),
    [error, setError] = useState(""),
    [id] = useState(() => existing?.id || crypto.randomUUID());
  const [evidence, setEvidence] = useState<FibEvidence>(existing?.evidence ?? {});
  const [stopVariants, setStopVariants] = useState(
    existing?.stopVariants ?? [],
  );
  const [form, setForm] = useState({
    stockId: String(existing?.stockId || stockId || instruments[0]?.id || ""),
    wave: existing?.wave || defaults.wave || "B",
    degree: existing?.degree || defaults.degree || "unbekannt",
    timeframe: existing?.timeframe || defaults.timeframe || "unbekannt",
    observedOn: existing?.observedOn || new Date().toISOString().slice(0, 10),
    status: existing?.status || "laufend",
    mode: existing?.anchorStart != null ? "anchors" : "direct",
    percent: existing?.percent != null ? String(existing.percent) : "",
    measurementKind:
      existing?.measurementKind || defaults.measurementKind || "retracement",
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
            evidence,
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
        toast.success(result.coverage.completed ? "Gespeichert, zurückgelesen und den passenden Kennzahlen zugeordnet." : "Gespeichert und zurückgelesen; Status schließt den Fall derzeit aus Abschlusskennzahlen aus.");
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
    <form
      onSubmit={submit}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden"
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2">
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-4">
          <legend className="mb-4 font-heading text-lg">
            1 · Welle zuordnen
          </legend>
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
          <h3 className="border-t border-border pt-4 font-heading text-lg">
            2 · Messwert festhalten
          </h3>
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
                  onChange={(e) =>
                    set(key as keyof typeof form, e.target.value)
                  }
                  aria-invalid={!!error}
                />
              </Field>
            ))}
          </FieldGroup>
          {form.mode === "anchors" && (
            <p className="rounded-lg bg-muted p-3 font-mono text-sm">
              Berechnete Tiefe:{" "}
              <strong>{formatResearchPercent(preview)}</strong>
              <span className="mt-1 block font-sans text-xs text-muted-foreground">
                Chronologisch Anfang → Ende; Korrekturextrem danach. Gleiche
                Währung und Kursskala.
              </span>
            </p>
          )}
          <FieldDescription>
            Ein unbekannter Messwert darf leer bleiben. Er wird als fehlend
            ausgewiesen und nicht als null Prozent gerechnet.
          </FieldDescription>
          <h3 className="border-t border-border pt-4 font-heading text-lg">
            3 · Herkunft & Zeitraum
          </h3>
          <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={prefix + "sourceRef"}>
                Quelle / Referenz
              </FieldLabel>
              <Input
                id={prefix + "sourceRef"}
                value={form.sourceRef}
                onChange={(e) => set("sourceRef", e.target.value)}
                placeholder="z. B. eigener Chart, Datum und Markierung"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={prefix + "measurementBasis"}>
                {form.measurementKind === "expansion"
                  ? "Bezugsbasis der Expansion"
                  : "Bezugsbasis (optional)"}
              </FieldLabel>
              <Input
                id={prefix + "measurementBasis"}
                value={form.measurementBasis}
                required={form.measurementKind === "expansion"}
                onChange={(e) => set("measurementBasis", e.target.value)}
              />
            </Field>
            <DateFilter
              label="Zeitraum von"
              value={form.periodFrom}
              onChange={(v) => set("periodFrom", v)}
            />
            <DateFilter
              label="Zeitraum bis"
              value={form.periodTo}
              onChange={(v) => set("periodTo", v)}
            />
          </FieldGroup>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor={prefix + "note"}>
              Messnotiz / Quelle
            </FieldLabel>
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
              Unterscheidet die konkrete Welle von früheren Fällen. Bei
              Änderungen am Extrem diese Beobachtung korrigieren.
            </FieldDescription>
          </Field>
          <ResidenceEditor value={evidence.targetZoneResidence} zone={evidence.targetZone ?? null} onChange={targetZoneResidence=>setEvidence(previous=>({...previous,targetZoneResidence,provenance:previous.provenance || "Direkte Formulareingabe des Nutzers"}))}/>
          <details
            className="rounded-lg border border-border p-4"
            open={existing?.stopVariants?.length ? true : undefined}
          >
            <summary className="cursor-pointer text-sm font-medium">
              Levels, Zonen, Richtung, CRV & weitere Angaben{" "}
              <span className="font-normal text-muted-foreground">
                · optional
              </span>
            </summary>
            <div className="mt-4 flex flex-col gap-4">
              <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(
                  [
                    ["structure", "Struktur / Korrekturtyp"],
                    ["target", "Kursziel"],
                    [
                      "stopDescription",
                      "Stop relativ zu Box / Trendwendebereich",
                    ],
                    ["sourceKey", "Stabile Quellenkennung (optional)"],
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
                      type={
                        key === "target" || key === "tradeId"
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
                  options={choices([
                    "unbekannt",
                    "handelbar",
                    "nicht_handelbar",
                  ])}
                />
                {(["hypotheticalOutcome", "actualOutcome"] as const).map(
                  (key) => (
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
                  ),
                )}
              </FieldGroup>
              <EvidenceEditor value={evidence} onChange={setEvidence} />
              <StopVariantsEditor
                value={stopVariants}
                onChange={setStopVariants}
              />
            </div>
          </details>
        </fieldset>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-popover pb-1 pt-4">
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
