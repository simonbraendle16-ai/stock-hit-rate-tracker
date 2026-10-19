"use client";
import { formatWaveDegree } from "@/lib/wave-degree-labels";
import { CategoricalFibForm } from "@/components/fibonacci-categorical-form";
import { CategoricalResults } from "@/components/fibonacci-categorical-results";
import { STRUCTURES } from "@/lib/fibonacci-catalogue";
import { TradeAnalysis } from "@/components/trade-analysis";
import { fibonacciReadModel } from "@/lib/fibonacci-read-model";
import { ResearchDataGroups } from "@/components/research-data-groups";
import { interpretFibSearch, describeSearchCriterion, type SearchResolutions } from "@/lib/fibonacci-search";
import { RESEARCH_LEVELS } from "@/lib/fibonacci-catalogue";
import { levelSearchGroups, levelGroupLabels, levelMeaningLabels } from "@/lib/fibonacci-level-search";
import { useMemo, useState, useId, type SetStateAction } from "react";
import { useFibonacciLocation } from "./use-fibonacci-location";
import { defaultResearchView, writeResearchLocation } from "@/lib/fibonacci-location";
import { researchResult, researchCsv } from "@/lib/fibonacci-research";
import type { ResearchQuery } from "@/lib/fibonacci-query-values";
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
import {
  FIB_LEVELS,
  FIB_WAVES,
  FIB_DEGREES,
  FIB_TIMEFRAMES,
  fibStats,
  type FibObservation,
  type FibFilters,
} from "@/lib/fibonacci";
import { researchMetrics, type MetricSample } from "@/lib/research-metrics";
import { ResearchMetricSummary } from "@/components/research-metric-summary";
import {
  FibonacciHistoryPanel,
  type HistorySummary,
} from "@/components/fibonacci-history-panel";
import { type TradeResearchRow } from "@/lib/trade-research-coverage";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FibonacciObservationList, FibonacciObservationDetails } from "@/components/fibonacci-observation-list";
import {
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
        onValueChange={(v) => onChange(all && v === "all" ? "" : String(v ?? ""))}
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
  const queryId = useId();
  const {view,setView,loaded,detail:openDetail,restoreDetailFocus} = useFibonacciLocation(stockId);
  const request = view.request;
  const update = <K extends keyof ResearchQuery>(key:K,value:SetStateAction<ResearchQuery[K]>) =>
    setView(v=>({...v,request:{...v.request,[key]:typeof value === "function" ? (value as (old:ResearchQuery[K])=>ResearchQuery[K])(v.request[key]) : value}}));
  const {query,resolutions,filters,search,selection,order} = request;
  const page = Math.floor(request.offset / 20), tab = view.tab;
  const setQuery = (v:SetStateAction<string>)=>update("query",v);
  const setResolutions = (v:SetStateAction<SearchResolutions>)=>update("resolutions",v);
  const setFilters = (v:SetStateAction<FibFilters>)=>update("filters",v);
  const setSearch = (v:SetStateAction<string>)=>update("search",v);
  const setSelection = (v:SetStateAction<ResearchSelection>)=>update("selection",v);
  const setOrder = (v:SetStateAction<ResearchOrder>)=>update("order",v);
  const setPage = (v:number)=>update("offset",v*20);
  const setTab = (v:string)=>setView(old=>({...old,tab:v}));
  const [searchMessage, setSearchMessage] = useState("");
  const [editing, setEditing] = useState<FibObservation | null>(null);
  const [open,setOpen] = useState(false);
  const interpretation = useMemo(()=>interpretFibSearch(query,instruments,filters,resolutions),[query,instruments,filters,resolutions]);
  const searchPending = !loaded || !!view.error || !!query.trim();
  // The same full-population pipeline powers API, table, statistics and CSV.
  const result = useMemo(()=>researchResult(observations,instruments,{...request,query:"",resolutions:{}}),[observations,instruments,request]);
  const filtered = result.selected;
  const stats = result.stats ?? fibStats([],filters.measurementKind);
  const waveLabels = [
    ...new Set([...FIB_WAVES, ...observations.map((r) => r.wave)]),
  ];
  const readModel = useMemo(()=>fibonacciReadModel(filtered,tradeCoverage,samples,filters.stockId),[filtered,tradeCoverage,samples,filters.stockId]);
  const timeGroups = result.timeSelection ?? {error:result.error,basis:filters.timeBasis,groups:{certain:[],possible:[],unknown:[],excluded:[]},denominator:0};
  const metrics = readModel.metrics;
  const levelGroups = result.levelSelection ?? {...levelSearchGroups([],filters),error:result.error};
  const set = (key: keyof FibFilters, value: string) => {
    setFilters((f) => ({
      ...f,
      [key]:
        ["stockId", "levelFrom", "levelTo"].includes(key)
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
  const sorted = result.ordered;
  const shown = sorted.slice(currentPage * 20, (currentPage + 1) * 20);
  const advancedCount = [
    filters.status,
    filters.market,
    filters.from,
    filters.to,
    filters.timeBasis === "recorded",
    filters.timeMatch && filters.timeMatch !== "certain",
    filters.hierarchyRole,
    filters.observationId,
    filters.observationId && filters.waveScope === "descendants",
  ].filter(Boolean).length;
  const reset = () => {
    setView(defaultResearchView(stockId));
    setSearchMessage("");
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
      new Blob([researchCsv(result)], { type: "text/csv;charset=utf-8" }),
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
            Eine konkrete Welle pro Beobachtung. Feste Fibonacci-Levels, Wellenstrukturen und getrennte Dauergruppen.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={download}
            disabled={searchPending || !!levelGroups.error || !filtered.length}
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

      {view.error && <p role="alert">Suchadresse ungültig: {view.error} <Button variant="outline" onClick={reset}>Auswahl zurücksetzen</Button></p>}
      {!searchPending && !levelGroups.error && <div
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
          ["Abgeschlossene Wellen", String(stats.coverage.completed), `${stats.running} laufend · ${stats.unclear} unklar · ${stats.invalid} ungültig`],
          ["Mit Levelangaben", String(filtered.filter(r=>r.evidence?.keyFibLevel != null || r.evidence?.reachedLevels?.length || r.evidence?.missedLevels?.length || r.evidence?.reversalZone).length), "Schlüsselfibonacci, erreichte/verfehlte Levels oder beobachtete Umkehr"],
          ["Dauergruppen", String(stats.categorical.durations.groups.length), "Nach Welle, Wellengrad und Timeframe getrennt"],
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
      </div>}

      <Card className="panel">
        <CardHeader className="pb-0">
          <CardTitle>Deine Untersuchung</CardTitle>
          <CardDescription>
            Suche und Filter gelten für Protokoll, Kennzahlen, Vergleiche und
            CSV.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={queryId}>Begriffssuche in strukturierte Filter übersetzen</FieldLabel>
              <Input id={queryId} value={query} onChange={e=>{setQuery(e.target.value);setResolutions({});setSearchMessage("");setPage(0);}} placeholder="Tesla Welle 4 2020–2025 ABC 61,8" />
            </Field>
            {searchPending && <>
              <p role="status" className="text-sm">Erkannt: {interpretation.recognized.map(c=>describeSearchCriterion(c,instruments)).join(" · ") || "noch keine Kriterien"}. Bis zur Übernahme keine endgültige Statistik.</p>
              {interpretation.pending.map(choice=><Choice key={choice.key} label={choice.label} value={resolutions[choice.key] || ""} onChange={v=>setResolutions(r=>({...r,[choice.key]:v}))} options={choice.options} />)}
              {!!interpretation.unknown.length && <p role="alert">Nicht verstanden: {interpretation.unknown.join(" · ")}. Bitte Suchtext korrigieren.</p>}
              {!!interpretation.conflicts.length && <p role="alert">Widerspruch: {interpretation.conflicts.join(" · ")}. Suchtext oder bestehende Filter korrigieren.</p>}
              <Button type="button" disabled={!interpretation.ready} onClick={()=>{setFilters(interpretation.filters);setQuery("");setResolutions({});setSearchMessage("Suchkriterien übernommen. Die manuellen Filter zeigen dieselbe Auswahl.");setPage(0);}}>Suchkriterien übernehmen</Button>
            </>}
            {searchMessage && <p role="status">{searchMessage}</p>}
          </FieldGroup>
          <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem]">
            <Field>
              <FieldLabel htmlFor={searchId}>
                <Search className="size-3.5" />
                Ergänzende Textsuche (Quelle / Notiz)
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
                { value: "missing", label: "Ohne exakten Alt-Messwert" },
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
            <Choice
              label="Wellengrad"
              value={filters.degree || ""}
              onChange={(v) => set("degree", v)}
              options={FIB_DEGREES.map(value => ({value,label:formatWaveDegree(value)}))}
            />
            <Choice all={false} label="Wellenlabel-Umfang" value={filters.waveLabelScope ?? "self"} onChange={v=>set("waveLabelScope",v)} options={[{value:"self",label:"Welle selbst"},{value:"descendants",label:"Einschließlich Unterwellen"}]}/>
            <Choice label="Levelbedeutung" value={filters.levelMeaning ?? ""} onChange={v=>set("levelMeaning",v)} options={Object.entries(levelMeaningLabels).map(([value,label])=>({value,label}))}/>
            <Choice label="Fibonacci-Level / von" value={filters.levelFrom === undefined ? "" : String(filters.levelFrom)} onChange={v=>set("levelFrom",v)} options={RESEARCH_LEVELS.map(n=>({value:String(n),label:n.toLocaleString("de-DE")}))}/>
            <Choice label="Fibonacci-Bereich bis (optional)" value={filters.levelTo === undefined ? "" : String(filters.levelTo)} onChange={v=>set("levelTo",v)} options={RESEARCH_LEVELS.map(n=>({value:String(n),label:n.toLocaleString("de-DE")}))}/>
            <Choice label="Wellenstruktur" value={filters.structure || ""} onChange={v=>set("structure",v)} options={[...STRUCTURES.map(([value,label])=>({value,label})),...([...new Set(STRUCTURES.map(([, ,parent])=>parent))].filter(p=>p!=="unknown").map(parent=>({value:`family:${parent}`,label:`Hauptstruktur: ${parent}`})))]}/>

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
                <Choice all={false} label="Zeitbasis" value={filters.timeBasis ?? "historical"} onChange={v=>set("timeBasis",v)} options={[{value:"historical",label:"Historische Wellenzeit"},{value:"recorded",label:"Erfassungsdatum"}]}/>
                <Choice all={false} label="Zeittreffer" value={filters.timeMatch ?? "certain"} onChange={v=>set("timeMatch",v)} options={[{value:"certain",label:"Sichere Treffer"},{value:"possible",label:"Mögliche Treffer"},{value:"unknown",label:"Zeitlich unbekannt"},{value:"all",label:"Alle außer ausgeschlossenen"}]}/>
                <Choice label="Hierarchiegruppe" value={filters.hierarchyRole ?? ""} onChange={v=>set("hierarchyRole",v)} options={[{value:"main",label:"Hauptwellen / ohne Elternbezug"},{value:"subwaves",label:"Unterwellen"}]}/>
                <Choice label="Ausgangswelle" value={filters.observationId ?? ""} onChange={v=>{set("observationId",v);if(!v)set("waveScope","");}} options={observations.map(r=>({value:r.id,label:`${r.ticker} · ${r.wave} · ${r.id}`}))}/>
                {filters.observationId && <Choice all={false} label="Wellenumfang" value={filters.waveScope ?? "self"} onChange={v=>set("waveScope",v)} options={[{value:"self",label:"Welle selbst"},{value:"descendants",label:"Einschließlich Unterwellen"}]}/>}
                <DateFilter
                  label="Zeitraum von (JJJJ, JJJJ-MM oder Datum)"
                  value={filters.from || ""}
                  onChange={(v) => set("from", v)}
                />
                <DateFilter
                  label="Zeitraum bis (JJJJ, JJJJ-MM oder Datum)"
                  value={filters.to || ""}
                  onChange={(v) => set("to", v)}
                />
              </FieldGroup>
            </details>
            <Button variant="ghost" size="sm" onClick={reset}>
              Auswahl zurücksetzen
            </Button>
          </div>
          {timeGroups.error && <p role="alert">{timeGroups.error}</p>}
          {!searchPending && !levelGroups.error && <>
          {!timeGroups.error && (filters.from || filters.to) && <p className="text-sm" role="status">Zeitbasis: {timeGroups.basis === "historical" ? "historische Wellenzeit" : "Erfassungsdatum"}. {timeGroups.groups.certain.length} sicher · {timeGroups.groups.possible.length} möglich · {timeGroups.groups.unknown.length} unbekannt · {timeGroups.groups.excluded.length} ausgeschlossen / {timeGroups.denominator} Fälle.</p>}
          <p className="text-sm">Getrennte Hierarchiegruppen: {readModel.hierarchyGroups.map(g=>`${g.role === "main" ? "Hauptwellen / ohne Elternbezug" : "Unterwellen"}: ${g.n}`).join(" · ")}</p>
          </>}

        </CardContent>
      </Card>

      {levelGroups.error && <p role="alert">{levelGroups.error}</p>}
      {!searchPending && !levelGroups.error && <>
      {filters.levelFrom !== undefined && <Card><CardHeader><CardTitle>Getrennte Leveltreffer</CardTitle><CardDescription>{levelGroups.total} eindeutige Fälle. Gruppenzahlen werden nicht addiert. Endlagen erfordern einen dokumentierten Abschluss; Maximalmessung und hypothetischer Ausstieg sind kein Endlevel.</CardDescription></CardHeader><CardContent className="flex flex-col gap-2">{Object.entries(levelGroups.groups).map(([key,ids])=><details key={key}><summary>{levelGroupLabels[key]}: {ids.length}</summary><p className="break-all text-xs">{ids.join(" · ") || "Keine Fälle"}</p></details>)}</CardContent></Card>}
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

      <CategoricalResults stats={stats.categorical}/>
      <Card><CardHeader><CardTitle>Zielzonenkontakt bis Wellenwendepunkt · exakte Dauern</CardTitle><CardDescription>Erster Kontakt mit der dokumentierten Zielzone bis Ende der untersuchten Welle / Beginn der Folgewelle, nicht bis zur späteren Bestätigung. Kalenderzeit; getrennt von der Verweildauer in der Zone. Nur abgeschlossene Fälle mit ausdrücklich exakter Angabe zählen im jeweiligen Gruppenmittel.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">
        {!stats.coverage.reversalComparisons.groups.length && <p className="text-sm">Noch keine vergleichbaren exakten Wendepunktdauern in dieser Auswahl.</p>}
        {stats.coverage.reversalComparisons.groups.map((g,i)=><div key={i} className="text-sm"><p>Welle {g.wave} · {formatWaveDegree(g.degree)} · {g.timeframe} · {g.zone.join("–")} % · Kalenderzeit · n={g.n} · Mittel {fmt(g.average)} / Median {fmt(g.median)} Stunden</p><details><summary>Datengrundlage der Wendepunktdauer prüfen</summary>{g.included.map(r=><p key={r.id} className="text-xs">{r.id}: {fmt(r.value)} Stunden</p>)}</details></div>)}
        <details><summary>Ausschlüsse der Wendepunktdauer ({stats.coverage.reversalComparisons.excluded.length})</summary>{stats.coverage.reversalComparisons.excluded.map(r=><p key={r.id} className="text-xs">{r.id}: {r.reason}</p>)}</details>
      </CardContent></Card>
      <details><summary className="cursor-pointer text-sm text-muted-foreground">Bestandsdaten und ergänzende Kennzahlen</summary>
      <Card><CardHeader><CardTitle>Abdeckung abgeschlossener Beobachtungen</CardTitle><CardDescription>{observations.length} insgesamt gespeichert · {stats.coverage.total} im aktuellen Filter · {stats.coverage.completed} abgeschlossen. Jede Abschlusskennzahl verwendet ihre eigene Datenbasis. Vorläufige Angaben stehen unter „Laufend &amp; Simulation“.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3">
      {Object.entries(stats.coverage).filter(([,v])=>typeof v === "object" && v !== null && "definition" in v).map(([key,raw])=>{
        const m=raw as typeof stats.coverage.exact;
        const labels:Record<string,string>={stopDescription:"Stopbeschreibung",stopVariants:"Stopvarianten",targetZoneReversal:"Zielzonenkontakt bis Wellenwendepunkt",reversalKind:"Genauigkeit der Wendepunktdauer",targetZoneResidence:"Verweildauer in der Zielzone",residenceKind:"Genauigkeit der Verweildauer",touchAndGo:"Touch-and-Go / länger verweilt",approximateReached:"Ungefähr erreichte Levels",hypotheticalExitLevel:"Hypothetischer Ausstiegslevel",hypotheticalCRVBasis:"CRV-Bezugsziel",unassignedLevels:"Levels mit ungeklärter Messart",exact:"Exakte Prozentmessung",approximate:"Ungefähre Prozentmessung",reached:"Erreichte Levels",missed:"Verfehlte Levels",reversalZone:"Umkehrzone",targetZone:"Zielzone",direction:"Wellenrichtung",period:"Zeitraum",duration:"Wellendauer",reversalDuration:"Umkehrdauer ? Altangabe, Messgrenzen offen",structure:"Struktur",basis:"Messbasis",hypotheticalCRV:"Hypothetisches CRV",tradability:"Handelbarkeit",hypotheticalOutcome:"Hypothetischer Ausgang",actualOutcome:"Tatsächlicher qualitativer Ausgang"};
        return <details key={key}><summary>{labels[key] ?? key}: {m.n} von {m.denominator}{m.average != null ? ` · Durchschnitt ${fmt(m.average)}` : ""}</summary><p className="text-sm text-muted-foreground">{m.definition}</p>{m.distribution.map(d=><p className="text-xs" key={d.value}>{d.value}: {d.count} Fälle · {fmt(d.share)} % von {m.n}</p>)}{m.included.map(r=><p className="break-words text-xs" key={r.id}>{r.id}: {JSON.stringify(r.value)}</p>)}{m.excluded.map(r=><p className="break-words text-xs text-muted-foreground" key={r.id}>{r.id}: {r.reason}</p>)}</details>;
      })}
      <details><summary>Vergleichbare exakte Verweildauern: {stats.coverage.residenceComparisons.groups.reduce((n,g)=>n+g.n,0)} von {stats.coverage.total}</summary>
        <p className="text-sm text-muted-foreground">Nur abgeschlossene Fälle mit exakter Dauer, bekannter Zeitbasis und identischer Messkonvention. Schätzungen und Grenzen bleiben außerhalb der Mittelwerte.</p>
        {stats.coverage.residenceComparisons.groups.map((g,i)=><div key={i} className="text-sm"><p>Welle {g.wave} · {formatWaveDegree(g.degree)} · {g.timeframe} · {g.zone.join("–")} % · {g.timeBasis === "calendar" ? "Kalenderzeit" : "Handelszeit"} · {g.convention} · n={g.n} · Mittel {fmt(g.average)} / Median {fmt(g.median)} {g.unit === "hour" ? "Stunden" : g.unit === "day" ? "Tage" : "Minuten"}</p>{g.included.map(r=><p key={r.id} className="text-xs">{r.id}: {fmt(r.value)}</p>)}</div>)}
        {stats.coverage.residenceComparisons.excluded.map(r=><p key={r.id} className="text-xs text-muted-foreground">{r.id}: {r.reason}</p>)}
      </details>
      {stats.coverage.levelProfile.map(l=><p className="text-sm" key={l.level}>{l.level} %: {l.reached.length} erreicht · {l.missed.length} verfehlt · n={l.n}. Nur explizite Angaben zu diesem Level.</p>)}
      </CardContent></Card></details>
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
            <TabsTrigger value="distribution">Altbestand · exakte Werte</TabsTrigger>
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
                  <FibonacciObservationList rows={shown} onEdit={edit} onDetails={openDetail} detailHref={id=>"?"+writeResearchLocation(new URLSearchParams(typeof window === "undefined" ? "" : window.location.search),{...view,detail:id}).toString()+"#fibonacci"} />
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
                  Keine exakten Messwerte im Altbestand
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
      </>}
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
      <Dialog open={!!view.detail && loaded} onOpenChange={v=>{if(!v)openDetail();}}>
        <DialogContent finalFocus={restoreDetailFocus} className="flex max-h-[90svh] flex-col overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Beobachtungsdetails</DialogTitle><DialogDescription>Gespeicherter Fall. Die Suche bleibt beim Schließen erhalten.</DialogDescription></DialogHeader>
          {observations.find(r=>r.id===view.detail) ? <FibonacciObservationDetails row={observations.find(r=>r.id===view.detail)!} expanded /> : <p role="alert">Beobachtung nicht verfügbar. Sie wurde entfernt oder ist für dieses Konto beziehungsweise Instrument nicht zugänglich.</p>}
          <Button variant="outline" onClick={()=>openDetail()}>Zurück zur Auswahl</Button>
        </DialogContent>
      </Dialog>
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
            <CategoricalFibForm
              key={editing?.id || "new"}
              observations={observations}
              trades={tradeCoverage}
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
        type="text"
        placeholder="2008 oder 2008-03 oder 2008-03-12"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
