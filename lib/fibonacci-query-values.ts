import { SUBDIVISIONS, SUBDIVISION_CONFIDENCES } from "./fibonacci-subdivision";
import { dateEnvelope } from "./fibonacci-time";
import { WAVE_VARIANTS, waveVariant, waveVariantError } from "./fibonacci-wave-variants";
import { STRUCTURES } from "./fibonacci-catalogue";
import { LEVEL_MEANINGS, levelSearchError } from "./fibonacci-level-search";
import type { SearchResolutions } from "./fibonacci-search";
import type { ResearchOrder, ResearchSelection } from "./fibonacci-workspace";
export class ResearchQueryError extends Error {}
export type ResearchQuery = ReturnType<typeof readResearchQuery>;
import { FIB_DEGREES, FIB_TIMEFRAMES, type FibFilters } from "@/lib/fibonacci";
export function readResearchQuery(p: URLSearchParams, context = false, incomplete = false) {
  const dimensions = [
    "stockId",
    "market",
    "wave",
    "waveVariant",
    "structure",
    "subdivision", "subdivisionConfidence",
    "degree",
    "timeframe",
    "timeBasis", "timeMatch", "observationId", "waveScope", "hierarchyRole",
    "waveLabelScope", "levelFrom", "levelTo", "levelMeaning",
    "from",
    "to",
    "measurementKind",
    "status",
    "contextId",
    "sourceKey",
  ];
  const allowed = [
    ...dimensions,
    "limit",
    "offset",
    ...(context ? ["instrument"] : ["search","selection","query","resolutions","order","format"]),
  ];
  if ([...p.keys()].some((k) => !allowed.includes(k) || p.getAll(k).length !== 1))
    throw new ResearchQueryError("Unbekannter Filter.");
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = p.get(key),
      n = raw === null ? fallback : Number(raw);
    if (
      (raw !== null && !/^\d+$/.test(raw)) ||
      !Number.isSafeInteger(n) ||
      n < min ||
      n > max
    )
      throw new ResearchQueryError(`Ungültiger Filter: ${key}.`);
    return n;
  };
  for (const [key, options] of Object.entries({
    subdivision: SUBDIVISIONS.map(v=>v.code),
    subdivisionConfidence: SUBDIVISION_CONFIDENCES.map(v=>v.code),
    waveVariant: WAVE_VARIANTS.map(v => v.code),
    structure: [...STRUCTURES.map(([c])=>c),...new Set(STRUCTURES.map(([, ,p])=>`family:${p}`))],
    timeBasis: ["historical","recorded"],
    timeMatch: ["certain","possible","unknown","all"],
    waveScope: ["self","descendants"],
    waveLabelScope: ["self","descendants"],
    levelMeaning: LEVEL_MEANINGS,
    hierarchyRole: ["main","subwaves"],
    degree: FIB_DEGREES,
    timeframe: FIB_TIMEFRAMES,
    measurementKind: ["retracement", "expansion"],
    status: ["laufend", "abgeschlossen", "unklar", "ungueltig"],
    market: [
      "aktien",
      "krypto",
      "forex",
      "rohstoffe",
      "etf",
      "optionen",
      "sonstiges",
    ],
  }))
    if (p.has(key) && !(options as readonly string[]).includes(p.get(key)!))
      throw new ResearchQueryError(`Unbekannter Filterwert: ${key}.`);
  if (p.has("wave") && (!p.get("wave")!.trim() || p.get("wave")!.length > 40))
    throw new ResearchQueryError("Ungültiges Wellenlabel.");
  try {
    for (const key of ["from","to"]) if (p.has(key)) dateEnvelope(p.get(key)!);
    if (p.has("from") && p.has("to") && dateEnvelope(p.get("from")!)[0] > dateEnvelope(p.get("to")!)[1]) throw Error();
  } catch { throw new ResearchQueryError("Ungültiger oder umgekehrter Zeitraum."); }
  if (p.has("observationId") && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.get("observationId")!)) throw new ResearchQueryError("Ungültige Beobachtungs-ID.");
  if (p.has("waveScope") && !p.has("observationId")) throw new ResearchQueryError("Wellenumfang benötigt eine Beobachtungs-ID.");
  if (
    p.has("contextId") &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      p.get("contextId")!,
    )
  )
    throw new ResearchQueryError("Ungültige Wellenkontext-ID.");
  if (
    p.has("sourceKey") &&
    (!p.get("sourceKey")!.trim() || p.get("sourceKey")!.length > 200)
  )
    throw new ResearchQueryError("Ungültige Quellenkennung.");
  const filters = Object.fromEntries(
    dimensions
      .filter((k) => p.has(k))
      .map((k) => [
        k,
        k === "stockId" ? integer(k, 0, 1, 2147483647) : ["levelFrom","levelTo"].includes(k) ? Number(p.get(k)) : p.get(k)!,
      ]),
  ) as FibFilters;
  const variantError = waveVariantError(filters.wave, filters.waveVariant);
  if (variantError) throw new ResearchQueryError(variantError);
  if (filters.waveVariant && !filters.wave) filters.wave = waveVariant(filters.waveVariant)!.wave;
  for (const key of ["levelFrom", "levelTo"]) if (p.has(key) && !/^\d+(?:\.\d+)?$/.test(p.get(key)!)) throw new ResearchQueryError("Ungültiges Fibonacci-Level.");
  if (!incomplete && !p.get("query")?.trim() && levelSearchError(filters)) throw new ResearchQueryError(levelSearchError(filters)!);
  const query = p.get("query") ?? "";
  if (query.length > 2000) throw new ResearchQueryError("Suchtext auf 2000 Zeichen begrenzen.");
  let resolutions: SearchResolutions = {};
  if (p.has("resolutions")) {
    const raw = p.get("resolutions")!;
    try {
      if (raw.length > 4000) throw Error();
      const parsed = JSON.parse(raw);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || Object.entries(parsed).some(([k,v]) => !/^(instrument:\d+|waveLabelScope|levelMeaning)$/.test(k) || typeof v !== "string" || v.length > 100)) throw Error();
      resolutions = parsed;
    } catch { throw new ResearchQueryError("Ungültige Suchauflösungen."); }
  }
  const order = p.get("order") ?? "newest";
  if (!["newest","oldest","deepest"].includes(order)) throw new ResearchQueryError("Ungültige Sortierung.");
  const format = p.get("format") ?? "json";
  if (!["json","csv"].includes(format)) throw new ResearchQueryError("Ungültiges Exportformat.");
  const search = p.get("search") ?? "";
  const selection = p.get("selection") ?? "all";
  if (search.length > 2000 || !["all","missing","running","completed"].includes(selection)) throw new ResearchQueryError("Ungültige Suche/Arbeitsauswahl.");
  return {
    query, resolutions, order: order as ResearchOrder, format: format as "json" | "csv",
    search,
    selection: selection as import("@/lib/fibonacci-workspace").ResearchSelection,
    filters,
    limit: integer("limit", 100, 1, 500),
    offset: integer("offset", 0, 0, 1000000),
  };
}
