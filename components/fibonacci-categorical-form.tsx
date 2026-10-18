"use client";
import { HistoricalTimeFields } from "@/components/fibonacci-time-fields";
import { historicalTime } from "@/lib/fibonacci-time";
import { InstrumentPicker } from "@/components/instrument-picker";
import { formatWaveDegree } from "@/lib/wave-degree-labels";
import { useState, useTransition, useId } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveFibonacci } from "@/app/actions/fibonacci";
import {
  FIB_DEGREES,
  FIB_TIMEFRAMES,
  type FibEvidence,
  type FibFilters,
  type FibObservation,
} from "@/lib/fibonacci";
import {
  RESEARCH_WAVES,
  STRUCTURES,
  structureCode,
} from "@/lib/fibonacci-catalogue";
import { targetResult } from "@/lib/fibonacci-categorical-stats";
import {
  CatalogueChoice as Choice,
  ZoneChoice,
  LevelChoices,
  DurationChoice,
} from "@/components/fibonacci-categorical-inputs";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
  FieldDescription,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { TradeResearchRow } from "@/lib/trade-research-coverage";

const choices = (v: readonly string[]) => v.map((x) => [x, x] as const);
type Instrument = { id: number; name: string; ticker: string; market: string };
export function CategoricalFibForm({
  instruments,
  stockId,
  existing,
  defaults,
  close,
  trades = [],
  observations = [],
}: {
  instruments: Instrument[];
  stockId?: number;
  existing: FibObservation | null;
  defaults: FibFilters;
  close: () => void;
  trades?: TradeResearchRow[];
  observations?: FibObservation[];
}) {
  const router = useRouter(),
    prefix = useId(),
    [pending, startTransition] = useTransition(),
    [error, setError] = useState("");
  const [id] = useState(() => existing?.id ?? crypto.randomUUID());
  const [form, setForm] = useState(() => ({
    stockId: String(existing?.stockId ?? stockId ?? "none"),
    wave: existing?.wave ?? defaults.wave ?? "none",
    degree: existing?.degree ?? defaults.degree ?? "unbekannt",
    timeframe: existing?.timeframe ?? defaults.timeframe ?? "unbekannt",
    status: existing?.status ?? "laufend",
    measurementKind:
      existing?.measurementKind ?? defaults.measurementKind ?? "retracement",
    observedOn: existing?.observedOn ?? new Date().toISOString().slice(0, 10),
    periodFrom: existing?.periodFrom ?? "",
    periodTo: existing?.periodTo ?? "",
    note: existing?.note ?? "",
    sourceRef: existing?.sourceRef ?? "",
    tradeId: String(existing?.tradeId ?? "none"),
    tradability: existing?.tradability ?? "unbekannt",
    hypotheticalOutcome: existing?.hypotheticalOutcome ?? "unbekannt",
    actualOutcome: existing?.actualOutcome ?? "unbekannt",
  }));
  const [evidence, setEvidence] = useState<FibEvidence>(
    () =>
      existing?.evidence ?? {
        catalogueVersion: 1,
        provenance: "Direkte Formulareingabe des Nutzers",
      },
  );
  const [time, setTime] = useState(() => existing ? historicalTime(existing) : {start:null,end:null});
  const set = (k: keyof typeof form, v: string) =>
    setForm((p) => ({ ...p, [k]: v }));
  const setE = (v: Partial<FibEvidence>) =>
    setEvidence((p) => ({
      ...p,
      ...v,
      provenance: p.provenance || "Direkte Formulareingabe des Nutzers",
    }));
  const currentStructure =
    evidence.structureCode ?? structureCode(existing?.structure) ?? "unknown";
  const legacyStructure =
    existing?.structure &&
    !structureCode(existing.structure) &&
    !evidence.structureCode;
  const waves = [...RESEARCH_WAVES];
  if (existing && !waves.includes(existing.wave)) waves.push(existing.wave);
  const tradeOptions: (readonly [string, string])[] = trades
    .filter((t) => t.stockId === Number(form.stockId))
    .map((t) => [String(t.id), `Trade ${t.id}`] as const);
  if (
    existing?.tradeId &&
    !tradeOptions.some(([v]) => v === String(existing.tradeId))
  )
    tradeOptions.push([
      String(existing.tradeId),
      `Trade ${existing.tradeId} · bisherige Zuordnung`,
    ]);
  const draft = { ...existing, ...form, evidence } as unknown as FibObservation;
  const result = targetResult(draft);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (form.wave === "none" || form.stockId === "none") {
      setError("Instrument und Welle auswählen.");
      return;
    }
    if (
      !existing &&
      (form.timeframe === "unbekannt" ||
        !["long", "short"].includes(evidence.waveDirection ?? ""))
    ) {
      setError(
        "Richtung und Timeframe sind für neue Beobachtungen erforderlich.",
      );
      return;
    }
    const structure = evidence.structureCode
      ? (STRUCTURES.find(([code]) => code === evidence.structureCode)?.[1] ??
        null)
      : (existing?.structure ?? null);
    startTransition(async () => {
      try {
        const input = {
          stockId: Number(form.stockId),
          wave: form.wave,
          degree: form.degree,
          timeframe: form.timeframe,
          status: form.status,
          measurementKind: form.measurementKind,
          observedOn: form.observedOn,
          note: form.note,
          sourceRef: form.sourceRef || null,
          tradeId: form.tradeId === "none" ? null : Number(form.tradeId),
          tradability: form.tradability,
          hypotheticalOutcome: form.hypotheticalOutcome,
          actualOutcome: form.actualOutcome,
          structure,
          evidence: {...evidence,historicalTime:time,provenance:evidence.provenance || "Direkte Formulareingabe des Nutzers"},
          periodFrom: time.start?.precision === "day" && !time.start.approximate ? time.start.date : null,
          periodTo: time.end?.precision === "day" && !time.end.approximate ? time.end.date : null,
          // Historical measurements and links survive category-only edits.
          percent: existing?.percent ?? null,
          anchorStart: existing?.anchorStart ?? null,
          anchorEnd: existing?.anchorEnd ?? null,
          extreme: existing?.extreme ?? null,
          measurementBasis: existing?.measurementBasis ?? null,
          contextId: existing?.contextId ?? null,
          sourceKey: existing?.sourceKey ?? null,
          historyId: existing?.historyId ?? null,
          target: existing?.target ?? null,
          stopDescription: existing?.stopDescription ?? null,
          stopVariants: existing?.stopVariants ?? [],
        };
        const response = await saveFibonacci(id, input, existing?.version);
        if (!response.ok) {
          setError(response.error);
          return;
        }
        toast.success("Gespeichert und zurückgelesen.");
        router.refresh();
        close();
      } catch {
        setError(
          "Speicherung nicht bestätigt. Erneut versuchen; dieselbe Erfassungs-ID verhindert Duplikate.",
        );
      }
    });
  };
  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col gap-4">
      <div className="min-h-0 overflow-y-auto pr-2">
        <fieldset disabled={pending} className="flex min-w-0 flex-col gap-6">
          <FieldSet>
            <FieldLegend>1 · Kerndaten der Welle</FieldLegend>
            <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InstrumentPicker
                instruments={instruments}
                value={form.stockId}
                disabled={pending}
                onChange={(v) => {
                  setForm((p) => ({ ...p, stockId: v, tradeId: "none" }));
                }}
              />
              <Choice
                label="Welle"
                value={form.wave}
                options={[["none", "Bitte auswählen"], ...choices(waves)]}
                onChange={(v) => set("wave", v)}
              />
              <Choice
                label="Wellenstruktur / Untertyp"
                value={legacyStructure ? "legacy" : currentStructure}
                options={[
                  ...(legacyStructure
                    ? [
                        [
                          "legacy",
                          `${existing?.structure} · Altbestand`,
                        ] as const,
                      ]
                    : []),
                  ...STRUCTURES.map(([v, l]) => [v, l] as const),
                ]}
                onChange={(v) =>
                  setE({ structureCode: v as FibEvidence["structureCode"] })
                }
              />
              <Choice
                label="Sicherheit der Struktur"
                value={evidence.structureConfidence ?? "unbekannt"}
                options={[
                  ["unbekannt", "Unbekannt"],
                  ["bestaetigt", "Bestätigt"],
                  ["vermutet", "Vermutet"],
                ]}
                onChange={(v) =>
                  setE({
                    structureConfidence:
                      v as FibEvidence["structureConfidence"],
                  })
                }
              />
              <Choice
                label="Wellengrad"
                value={form.degree}
                options={FIB_DEGREES.map(value => [value, formatWaveDegree(value)] as const)}
                onChange={(v) => set("degree", v)}
              />
              <Choice
                label="Timeframe"
                value={form.timeframe}
                options={[
                  [
                    "unbekannt",
                    existing ? "Unbekannt · Altbestand" : "Bitte auswählen",
                  ],
                  ...choices(FIB_TIMEFRAMES.filter((v) => v !== "unbekannt")),
                ]}
                onChange={(v) => set("timeframe", v)}
              />
              <Choice
                label="Richtung der untersuchten Welle"
                value={evidence.waveDirection ?? "unbekannt"}
                options={[
                  [
                    "unbekannt",
                    existing ? "Unbekannt · Altbestand" : "Bitte auswählen",
                  ],
                  ["long", "Aufwärts"],
                  ["short", "Abwärts"],
                ]}
                onChange={(v) =>
                  setE({ waveDirection: v as FibEvidence["waveDirection"] })
                }
              />
              <Choice
                label="Messart"
                value={form.measurementKind}
                options={[
                  ["retracement", "Retracement"],
                  ["expansion", "Expansion"],
                ]}
                onChange={(v) => {
                  if (
                    existing &&
                    (existing.percent != null ||
                      existing.anchorStart != null) &&
                    v !== existing.measurementKind
                  ) {
                    setError(
                      "Ein vorhandener Messwert bleibt seiner bisherigen Messart zugeordnet. Für eine andere Messart eine eigene Beobachtung anlegen.",
                    );
                    return;
                  }
                  set("measurementKind", v);
                }}
              />
            </FieldGroup>
          </FieldSet>
          <FieldSet>
            <FieldLegend>2 · Erwartung</FieldLegend>
            <FieldDescription>
              Wellenziel, möglicher Trade-Einstieg und tatsächliche Umkehr sind
              getrennte Angaben.
            </FieldDescription>
            <ZoneChoice
              label="Erwartete Fibonacci-Zielzone"
              value={evidence.targetZone}
              onChange={(v) => setE({ targetZone: v })}
            />
            <Choice
              label="Wann stand die Erwartung fest?"
              value={evidence.expectationTiming ?? "unknown"}
              options={[
                ["unknown", "Unbekannt"],
                ["prior", "Vor der beobachteten Bewegung"],
                ["retrospective", "Rückblickend zugeordnet"],
              ]}
              onChange={(v) =>
                setE({
                  expectationTiming: v as FibEvidence["expectationTiming"],
                })
              }
            />
            <ZoneChoice
              label="Mögliche Einstiegszone · optional"
              value={evidence.entryZone}
              onChange={(v) => setE({ entryZone: v })}
            />
          </FieldSet>
          <FieldSet>
            <FieldLegend>3 · Tatsächliche Beobachtung</FieldLegend>
            <Choice
              label="Zielzone berührt / durchlaufen?"
              value={evidence.targetContact ?? "unknown"}
              options={[
                ["unknown", "Unbekannt"],
                ["not_reached", "Nicht erreicht"],
                ["reached", "Erreicht / durchlaufen"],
              ]}
              onChange={(v) =>
                setE({ targetContact: v as FibEvidence["targetContact"] })
              }
            />
            <Choice
              label="Beobachtete Umkehr"
              value={
                evidence.reversalLocation ??
                (evidence.reversalZone
                  ? evidence.reversalZone[0] === evidence.reversalZone[1]
                    ? "at_level"
                    : "between_levels"
                  : "unknown")
              }
              options={[
                ["unknown", "Nicht bekannt"],
                ["at_level", "Am Fibonacci-Level"],
                ["between_levels", "Zwischen zwei Fibonacci-Levels"],
              ]}
              onChange={(v) =>
                setE({
                  reversalLocation: v as FibEvidence["reversalLocation"],
                  reversalZone: null,
                })
              }
            />
            {((evidence.reversalLocation !== "unknown" &&
              evidence.reversalLocation) ||
              evidence.reversalZone) && (
              <ZoneChoice
                label="Beobachteter Umkehrbereich"
                value={evidence.reversalZone}
                point={evidence.reversalLocation === "at_level"}
                onChange={(v) => setE({ reversalZone: v })}
              />
            )}
            <p className="rounded-md bg-muted p-3 text-sm" role="status">
              {form.status !== "abgeschlossen"
                ? "Abschließende Zielbewertung erst bei abgeschlossener Welle."
                : result === "hit"
                  ? "Zieltreffer: Umkehr innerhalb der erwarteten Zone."
                  : result === "miss"
                    ? "Zielzone verfehlt: keine Umkehr innerhalb der erwarteten Zone."
                    : "Zielbewertung offen: Angaben reichen noch nicht für einen Treffer oder eine Verfehlung."}
            </p>
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Erreichte und verfehlte Levels auswählen
              </summary>
              <div className="mt-3 flex flex-col gap-5">
                <LevelChoices
                  label="Erreichte Fibonacci-Levels"
                  value={evidence.reachedLevels}
                  onChange={(v) => setE({ reachedLevels: v })}
                />
                <LevelChoices
                  label="Verfehlte Fibonacci-Levels"
                  value={evidence.missedLevels}
                  onChange={(v) => setE({ missedLevels: v })}
                />
              </div>
            </details>
          </FieldSet>
          <FieldSet>
            <FieldLegend>4 · Zeitraum und Verhalten</FieldLegend>
            <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Choice
                label="Wellenstatus"
                value={form.status}
                options={[
                  ["laufend", "Laufend"],
                  ["abgeschlossen", "Abgeschlossen"],
                  ["unklar", "Unklar"],
                  ["ungueltig", "Ungültig"],
                ]}
                onChange={(v) => set("status", v)}
              />
              {(
                [
                  ["observedOn", "Erfasst am"],
                ] as const
              ).map(([k, l]) => (
                <Field key={k}>
                  <FieldLabel htmlFor={prefix + k}>{l}</FieldLabel>
                  <Input
                    id={prefix + k}
                    type="date"
                    value={form[k]}
                    required={k === "observedOn"}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => set(k, e.target.value)}
                  />
                </Field>
              ))}
            </FieldGroup>
            <HistoricalTimeFields value={time} onChange={setTime}/>
            <Choice label="Elternwelle · optional" value={evidence.parentId ?? "none"} options={[["none","Keine Elternwelle"],...observations.filter(r=>r.id !== id && r.stockId === Number(form.stockId)).map(r=>[r.id,`${r.ticker} · ${r.wave} · ${r.id}`] as const)]} onChange={v=>setE({parentId:v === "none" ? null : v})}/>
            <DurationChoice
              label="Wellendauer"
              type="wave"
              value={evidence.durations?.wave}
              onChange={(v) =>
                setE({ durations: { ...evidence.durations, wave: v } })
              }
            />
            <DurationChoice
              label="Dauer der Umkehr"
              type="reversal"
              value={evidence.durations?.reversal}
              onChange={(v) =>
                setE({ durations: { ...evidence.durations, reversal: v } })
              }
            />
            {evidence.targetContact === "not_reached" ? (
              <p className="text-sm text-muted-foreground">
                Zielzone nicht erreicht: keine Aufenthaltsdauer. Bereits
                gespeicherte Aufenthaltsangaben müssen vor dieser Änderung
                ausdrücklich entfernt werden.
              </p>
            ) : (
              <>
                <Choice
                  label="Verhalten in der Zielzone"
                  value={
                    evidence.targetZoneResidence?.touchAndGo === true
                      ? "touch"
                      : evidence.targetZoneResidence?.touchAndGo === false
                        ? "residence"
                        : "unknown"
                  }
                  options={[
                    ["unknown", "Unbekannt / nicht erhoben"],
                    ["touch", "Touch-and-Go"],
                    ["residence", "Länger verweilt"],
                  ]}
                  onChange={(v) => {
                    if (!evidence.targetZone) {
                      setError("Zuerst die Fibonacci-Zielzone auswählen.");
                      return;
                    }
                    setE({
                      targetZoneResidence: {
                        ...(evidence.targetZoneResidence ?? {
                          kind: "unknown",
                          unit: "day",
                          timeBasis: "unknown",
                          measurementConvention: null,
                          originalText: null,
                          zone: [...evidence.targetZone],
                        }),
                        touchAndGo:
                          v === "touch"
                            ? true
                            : v === "residence"
                              ? false
                              : null,
                      },
                    });
                  }}
                />
                <DurationChoice
                  label="Aufenthalt in der Zielzone"
                  type="residence"
                  zone={evidence.targetZone}
                  value={evidence.durations?.residence}
                  onChange={(v) => {
                    if (v && !evidence.targetZone && !v.zone) {
                      setError("Zuerst die Fibonacci-Zielzone auswählen.");
                      return;
                    }
                    setE({
                      durations: { ...evidence.durations, residence: v },
                    });
                  }}
                />
              </>
            )}
            {(evidence.targetZoneResidence ||
              evidence.durations?.residence) && (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setE({
                    targetZoneResidence: null,
                    durations: { ...evidence.durations, residence: null },
                  })
                }
              >
                Aufenthaltsangaben ausdrücklich entfernen
              </Button>
            )}
          </FieldSet>
          <details>
            <summary className="cursor-pointer text-sm font-medium">
              5 · Optionale Ergänzungen
            </summary>
            <FieldGroup className="mt-3">
              <Field>
                <FieldLabel htmlFor={prefix + "note"}>
                  Messnotiz · optional
                </FieldLabel>
                <Textarea
                  id={prefix + "note"}
                  value={form.note}
                  maxLength={2000}
                  onChange={(e) => set("note", e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={prefix + "source"}>
                  Quelle / Link · optional
                </FieldLabel>
                <Input
                  id={prefix + "source"}
                  value={form.sourceRef}
                  maxLength={2000}
                  onChange={(e) => set("sourceRef", e.target.value)}
                />
              </Field>
              <Choice
                label="Trade-Verknüpfung · optional"
                value={form.tradeId}
                options={[["none", "Kein Trade"], ...tradeOptions]}
                onChange={(v) => set("tradeId", v)}
              />
              <Choice
                label="Handelbarkeit"
                value={form.tradability}
                options={[
                  ["unbekannt", "Unbekannt"],
                  ["handelbar", "Handelbar"],
                  ["nicht_handelbar", "Nicht handelbar"],
                ]}
                onChange={(v) => set("tradability", v)}
              />
              {(["hypotheticalOutcome", "actualOutcome"] as const).map((k) => (
                <Choice
                  key={k}
                  label={
                    k === "hypotheticalOutcome"
                      ? "Hypothetischer Ausgang"
                      : "Tatsächlicher Ausgang"
                  }
                  value={form[k]}
                  options={[
                    ["unbekannt", "Unbekannt"],
                    ["gewinn", "Gewinn"],
                    ["verlust", "Verlust"],
                    ["breakeven", "Break-even"],
                    ["ausgelassen", "Ausgelassen"],
                  ]}
                  onChange={(v) => set(k, v)}
                />
              ))}
              {existing && (
                <FieldDescription>
                  Vorhandene Messwerte, Quellenkennungen, Stopvarianten und
                  weitere Zusatzdaten bleiben bei dieser Korrektur erhalten.
                </FieldDescription>
              )}
            </FieldGroup>
          </details>
        </fieldset>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex shrink-0 justify-end gap-2 border-t border-border pt-4">
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
