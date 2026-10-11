export const FIB_LEVELS = [
  0, 23.6, 38.2, 50, 61.8, 78.6, 100, 127.2, 161.8, 200, 261.8, 423.6,
] as const;
export const FIB_WAVES = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "A",
  "B",
  "C",
  "X",
  "Y",
] as const;
export const FIB_DEGREES = [
  "GrandSupercycle",
  "Supercycle",
  "Zyklus",
  "Primär",
  "Intermediär",
  "Minor",
  "Minute",
  "Minuette",
  "Subminuette",
  "unbekannt",
] as const;
export const FIB_TIMEFRAMES = [
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "1d",
  "1w",
  "1M",
  "unbekannt",
] as const;
export type StopVariant = {
  label: string;
  description: string;
  kind: "hypothetisch" | "tatsaechlich";
  outcome: "unbekannt" | "gewinn" | "verlust" | "breakeven" | "ausgelassen";
  resultR: number | null;
};
export type FibInput = {
  stopVariants?: StopVariant[];
  stockId: number;
  wave: string;
  degree: string;
  timeframe: string;
  observedOn: string;
  status: "laufend" | "abgeschlossen" | "unklar" | "ungueltig";
  percent: number | null;
  anchorStart: number | null;
  anchorEnd: number | null;
  extreme: number | null;
  note: string;
  measurementKind?: "retracement" | "expansion";
  measurementBasis?: string | null;
  contextId?: string | null;
  sourceKey?: string | null;
  sourceRef?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  structure?: string | null;
  target?: number | null;
  stopDescription?: string | null;
  tradability?: "unbekannt" | "handelbar" | "nicht_handelbar";
  hypotheticalOutcome?:
    "unbekannt" | "gewinn" | "verlust" | "breakeven" | "ausgelassen";
  tradeId?: number | null;
  historyId?: string | null;
  actualOutcome?:
    "unbekannt" | "gewinn" | "verlust" | "breakeven" | "ausgelassen";
};
export type FibObservation = FibInput & {
  id: string;
  version: number;
  ticker: string;
  name: string;
  market: string;
};
export class FibonacciError extends Error {}
const fail = (message: string): never => {
  throw new FibonacciError(message);
};
export function retracement(start: number, end: number, extreme: number) {
  if (
    ![start, end, extreme].every((n) => Number.isFinite(n) && n > 0) ||
    start === end
  )
    return fail(
      "Positive Preise und unterschiedliche Referenzanker erforderlich.",
    );
  const value = ((end - extreme) / (end - start)) * 100;
  if (!Number.isFinite(value) || value < 0 || value > 500)
    return fail("Retracement muss zwischen 0 und 500 % liegen.");
  return value;
}
export function validateFibInput(raw: Record<string, unknown>): FibInput {
  const keys = [
    "stockId",
    "wave",
    "degree",
    "timeframe",
    "observedOn",
    "status",
    "percent",
    "anchorStart",
    "anchorEnd",
    "extreme",
    "note",
    "measurementKind",
    "measurementBasis",
    "contextId",
    "sourceKey",
    "sourceRef",
    "periodFrom",
    "periodTo",
    "structure",
    "target",
    "stopDescription",
    "tradability",
    "hypotheticalOutcome",
    "actualOutcome",
    "tradeId",
    "historyId",
    "stopVariants",
  ];
  if (Object.keys(raw).some((k) => !keys.includes(k)))
    return fail("Unbekanntes Eingabefeld.");
  if (!Number.isSafeInteger(raw.stockId) || Number(raw.stockId) <= 0)
    return fail("Instrument erforderlich.");
  raw = {
    ...raw,
    degree: raw.degree ?? "unbekannt",
    timeframe: raw.timeframe ?? "unbekannt",
  };
  for (const [key, options] of [
    ["degree", FIB_DEGREES],
    ["timeframe", FIB_TIMEFRAMES],
    ["status", ["laufend", "abgeschlossen", "unklar", "ungueltig"]],
  ] as const) {
    if (
      typeof raw[key] !== "string" ||
      !(options as readonly string[]).includes(raw[key] as string)
    )
      return fail(`Ungültige Angabe: ${key}.`);
  }
  raw = {
    ...raw,
    degree: raw.degree ?? "unbekannt",
    timeframe: raw.timeframe ?? "unbekannt",
  };
  // Validate defaults as well; callers may omit context dimensions without inventing them.
  if (
    !(FIB_DEGREES as readonly unknown[]).includes(raw.degree) ||
    !(FIB_TIMEFRAMES as readonly unknown[]).includes(raw.timeframe)
  )
    return fail("Ungültiger Wellengrad oder Zeiteinheit.");
  if (
    typeof raw.wave !== "string" ||
    !raw.wave.trim() ||
    raw.wave.trim().length > 40
  )
    return fail("Wellenlabel erforderlich (maximal 40 Zeichen).");
  const text = (key: string, max = 2000): string | null => {
    const value = raw[key];
    if (value == null || value === "") return null;
    if (typeof value !== "string" || value.length > max || !value.trim())
      return fail(`Ungültige Angabe: ${key}.`);
    return value.trim();
  };
  const measurementKind = raw.measurementKind ?? "retracement";
  if (!["retracement", "expansion"].includes(String(measurementKind)))
    return fail("Ungültige Messart.");
  const measurementBasis = text("measurementBasis");
  if (measurementKind === "expansion" && !measurementBasis)
    return fail("Bezugsbasis der Expansion erforderlich.");
  const contextId = text("contextId", 36);
  if (
    contextId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      contextId,
    )
  )
    return fail("Ungültige Wellenkontext-ID.");
  const validDate = (value: unknown): value is string =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value &&
    value <= new Date().toISOString().slice(0, 10);
  const periodFrom = text("periodFrom", 10),
    periodTo = text("periodTo", 10);
  if (
    (periodFrom && !validDate(periodFrom)) ||
    (periodTo && !validDate(periodTo)) ||
    (periodFrom && periodTo && periodFrom > periodTo)
  )
    return fail("Ungültiger Beobachtungszeitraum.");
  const target = raw.target ?? null;
  if (
    target !== null &&
    (typeof target !== "number" || !Number.isFinite(target) || target <= 0)
  )
    return fail("Positives Kursziel erforderlich.");
  const choice = (key: string, options: string[]) => {
    const value = raw[key] ?? "unbekannt";
    if (typeof value !== "string" || !options.includes(value))
      return fail(`Ungültige Angabe: ${key}.`);
    return value;
  };
  const tradeId = raw.tradeId ?? null;
  if (
    tradeId !== null &&
    (!Number.isSafeInteger(tradeId) || Number(tradeId) <= 0)
  )
    return fail("Ungültiger Trade-Bezug.");
  const historyId = text("historyId", 36);
  if (
    historyId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      historyId,
    )
  )
    return fail("Ungültiger Kursdatensatz.");
  const outcomes = [
    "unbekannt",
    "gewinn",
    "verlust",
    "breakeven",
    "ausgelassen",
  ];
  const stopVariants = raw.stopVariants ?? [];
  if (!Array.isArray(stopVariants) || stopVariants.length > 20)
    return fail("Maximal 20 Stopvarianten pro Welle.");
  const labels = new Set<string>();
  for (const v of stopVariants) {
    if (
      !v ||
      typeof v !== "object" ||
      Object.keys(v).some(
        (k) =>
          !["label", "description", "kind", "outcome", "resultR"].includes(k),
      ) ||
      typeof v.label !== "string" ||
      !v.label.trim() ||
      v.label.length > 200 ||
      typeof v.description !== "string" ||
      !v.description.trim() ||
      v.description.length > 2000 ||
      !["hypothetisch", "tatsaechlich"].includes(v.kind) ||
      !outcomes.includes(v.outcome) ||
      (v.resultR !== null &&
        (typeof v.resultR !== "number" || !Number.isFinite(v.resultR)))
    )
      return fail("Ungültige Stopvariante.");
    const key = v.kind + ":" + v.label.trim();
    if (labels.has(key))
      return fail("Stopvarianten brauchen eindeutige Namen je Ergebnisart.");
    labels.add(key);
  }
  const extra = {
    stopVariants: stopVariants.map((v) => ({
      ...v,
      label: v.label.trim(),
      description: v.description.trim(),
    })) as StopVariant[],
    tradeId: tradeId as number | null,
    historyId,
    measurementKind: measurementKind as "retracement" | "expansion",
    measurementBasis,
    contextId,
    sourceKey: text("sourceKey", 200),
    sourceRef: text("sourceRef"),
    periodFrom,
    periodTo,
    structure: text("structure", 200),
    target: target as number | null,
    stopDescription: text("stopDescription"),
    tradability: choice("tradability", [
      "unbekannt",
      "handelbar",
      "nicht_handelbar",
    ]) as FibInput["tradability"],
    hypotheticalOutcome: choice(
      "hypotheticalOutcome",
      outcomes,
    ) as FibInput["hypotheticalOutcome"],
    actualOutcome: choice(
      "actualOutcome",
      outcomes,
    ) as FibInput["actualOutcome"],
  };
  const date = raw.observedOn;
  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date ||
    date > new Date().toISOString().slice(0, 10)
  )
    return fail("Gültiges Beobachtungsdatum bis heute erforderlich.");
  const prices = [raw.anchorStart, raw.anchorEnd, raw.extreme];
  const hasPrices = prices.some((v) => v != null);
  let percent = raw.percent;
  if (measurementKind === "expansion" && hasPrices)
    return fail("Expansion direkt messen; keine unbestätigte Ankerformel.");
  if (hasPrices) {
    if (!prices.every((v) => typeof v === "number" && Number.isFinite(v)))
      return fail("Alle drei Ankerpreise angeben.");
    const computed = retracement(
      prices[0] as number,
      prices[1] as number,
      prices[2] as number,
    );
    if (
      percent != null &&
      (typeof percent !== "number" || Math.abs(percent - computed) > 0.01)
    )
      return fail("Prozentangabe widerspricht den Ankern.");
    percent = computed;
  }
  if (
    percent != null &&
    (typeof percent !== "number" ||
      !Number.isFinite(percent) ||
      percent < 0 ||
      (measurementKind === "retracement" && percent > 500))
  )
    return fail("Retracement muss zwischen 0 und 500 % liegen.");
  if (
    typeof raw.note !== "string" ||
    !raw.note.trim() ||
    raw.note.length > 2000
  )
    return fail("Messnotiz/Quelle erforderlich (maximal 2000 Zeichen).");
  return {
    ...extra,
    stockId: raw.stockId as number,
    wave: (raw.wave as string).trim(),
    degree: raw.degree as string,
    timeframe: raw.timeframe as string,
    observedOn: date,
    status: raw.status as FibInput["status"],
    percent: percent == null ? null : (percent as number),
    anchorStart: hasPrices ? (prices[0] as number) : null,
    anchorEnd: hasPrices ? (prices[1] as number) : null,
    extreme: hasPrices ? (prices[2] as number) : null,
    note: raw.note.trim(),
  };
}
export function fibZone(value: number) {
  // Halfway ties go to the higher reference level. Values beyond the final
  // midpoint remain in the final zone; exact depths remain available separately.
  for (let i = 0; i < FIB_LEVELS.length - 1; i++)
    if (value < (FIB_LEVELS[i] + FIB_LEVELS[i + 1]) / 2) return i;
  return FIB_LEVELS.length - 1;
}
function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q,
    lo = Math.floor(position),
    fraction = position - lo;
  return sorted[lo] + fraction * ((sorted[lo + 1] ?? sorted[lo]) - sorted[lo]);
}
export function fibStats(
  rows: readonly FibObservation[],
  measurementKind: "retracement" | "expansion" = "retracement",
) {
  rows = rows.filter(
    (r) => (r.measurementKind ?? "retracement") === measurementKind,
  );
  const latest = new Map<string, FibObservation>();
  for (const row of rows) {
    const key = row.contextId ?? row.id;
    if (!latest.has(key) || latest.get(key)!.version < row.version)
      latest.set(key, row);
  }
  rows = [...latest.values()];
  const completed = rows.filter((r) => r.status === "abgeschlossen");
  const measured = completed.filter(
    (r) =>
      r.percent !== null &&
      Number.isFinite(r.percent) &&
      r.percent >= 0 &&
      (measurementKind === "expansion" || r.percent <= 500),
  );
  const values = measured.map((r) => r.percent as number).sort((a, b) => a - b),
    n = values.length;
  const zones = FIB_LEVELS.map((level, i) => ({
    level,
    lower: i === 0 ? 0 : (FIB_LEVELS[i - 1] + level) / 2,
    upper:
      i === FIB_LEVELS.length - 1
        ? measurementKind === "expansion"
          ? null
          : 500
        : (level + FIB_LEVELS[i + 1]) / 2,
    count: 0,
    reached: 0,
  }));
  for (const value of values) {
    zones[fibZone(value)].count++;
    for (const z of zones) if (value + 1e-9 >= z.level) z.reached++;
  }
  const max = Math.max(0, ...zones.map((z) => z.count));
  return {
    n,
    measurementKind,
    unclear: rows.filter((r) => r.status === "unklar").length,
    missing: rows.filter(
      (r) => r.status === "abgeschlossen" && r.percent == null,
    ).length,
    structures: frequencies(completed, "structure"),
    stops: frequencies(completed, "stopDescription"),
    stopVariants: summarizeStopVariants(completed),

    running: rows.filter((r) => r.status === "laufend").length,
    invalid: rows.filter((r) => r.status === "ungueltig").length,
    mean: n ? values.reduce((a, b) => a + b, 0) / n : null,
    median: quantile(values, 0.5),
    q1: quantile(values, 0.25),
    q3: quantile(values, 0.75),
    modes: max ? zones.filter((z) => z.count === max).map((z) => z.level) : [],
    zones,
    exploratory: n < 10,
  };
}
export function summarizeStopVariants(rows: readonly FibObservation[]) {
  const groups = new Map<
    string,
    {
      label: string;
      description: string;
      kind: StopVariant["kind"];
      n: number;
      outcomes: Record<string, number>;
      values: number[];
    }
  >();
  for (const row of rows)
    for (const v of row.stopVariants ?? []) {
      const key = JSON.stringify([v.kind, v.label, v.description]);
      const g = groups.get(key) ?? {
        label: v.label,
        description: v.description,
        kind: v.kind,
        n: 0,
        outcomes: {},
        values: [],
      };
      g.n++;
      g.outcomes[v.outcome] = (g.outcomes[v.outcome] ?? 0) + 1;
      if (v.resultR !== null) g.values.push(v.resultR);
      groups.set(key, g);
    }
  return [...groups.values()]
    .map(({ values, ...g }) => ({
      ...g,
      averageR: values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : null,
      rCount: values.length,
    }))
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}
export function frequencies(
  rows: readonly FibObservation[],
  key: "structure" | "stopDescription",
) {
  const counts = new Map<string, number>();
  for (const row of rows)
    if (row[key]) counts.set(row[key]!, (counts.get(row[key]!) ?? 0) + 1);
  const n = [...counts.values()].reduce((a, b) => a + b, 0);
  return {
    n,
    missing: rows.length - n,
    items: [...counts]
      .map(([label, count]) => ({ label, count, percent: (count / n) * 100 }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}
export type FibFilters = {
  measurementKind?: "retracement" | "expansion";
  status?: FibInput["status"];
  contextId?: string;
  sourceKey?: string;
  stockId?: number;
  market?: string;
  wave?: string;
  degree?: string;
  timeframe?: string;
  from?: string;
  to?: string;
};
export function filterFib(
  rows: readonly FibObservation[],
  filters: FibFilters,
) {
  return rows.filter(
    (r) =>
      (!filters.measurementKind ||
        (r.measurementKind ?? "retracement") === filters.measurementKind) &&
      (!filters.status || r.status === filters.status) &&
      (!filters.contextId || r.contextId === filters.contextId) &&
      (!filters.sourceKey || r.sourceKey === filters.sourceKey) &&
      (!filters.stockId || r.stockId === filters.stockId) &&
      (!filters.market || r.market === filters.market) &&
      (!filters.wave || r.wave === filters.wave) &&
      (!filters.degree || r.degree === filters.degree) &&
      (!filters.timeframe || r.timeframe === filters.timeframe) &&
      (!filters.from || r.observedOn >= filters.from) &&
      (!filters.to || r.observedOn <= filters.to),
  );
}
export function fibCsv(rows: readonly FibObservation[]) {
  const cell = (v: unknown) =>
    '"' +
    String(v ?? "")
      .replaceAll('"', '""')
      .replace(/^[\s]*[=+\-@]|^[\t\r]/, "'$&") +
    '"';
  return (
    "\uFEFF" +
    [
      [
        "ID",
        "Instrument",
        "Ticker",
        "Markt",
        "Welle",
        "Wellengrad",
        "Zeiteinheit",
        "Datum",
        "Status",
        "Messwert %",
        "Messart",
        "Bezugsbasis",
        "Wellenkontext",
        "Quellenkennung",
        "Quelle",
        "Zeitraum von",
        "Zeitraum bis",
        "Struktur",
        "Kursziel",
        "Stopbeschreibung",
        "Handelbarkeit",
        "Hypothetischer Ausgang",
        "Tatsächlicher Ausgang",
        "Trade-ID",
        "Kursdatensatz-ID",
        "Stopvarianten (Nutzerangaben)",
        "Anfang",
        "Ende",
        "Extrem",
        "Messnotiz",
      ],
      ...rows.map((r) => [
        r.id,
        r.name,
        r.ticker,
        r.market,
        r.wave,
        r.degree,
        r.timeframe,
        r.observedOn,
        r.status,
        r.percent,
        r.measurementKind ?? "retracement",
        r.measurementBasis,
        r.contextId ?? r.id,
        r.sourceKey,
        r.sourceRef,
        r.periodFrom,
        r.periodTo,
        r.structure,
        r.target,
        r.stopDescription,
        r.tradability,
        r.hypotheticalOutcome,
        r.actualOutcome,
        r.tradeId,
        r.historyId,
        JSON.stringify(r.stopVariants ?? []),
        r.anchorStart,
        r.anchorEnd,
        r.extreme,
        r.note,
      ]),
    ]
      .map((row) => row.map(cell).join(";"))
      .join("\r\n")
  );
}
