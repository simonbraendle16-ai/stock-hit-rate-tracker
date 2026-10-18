import { STRUCTURES } from "./fibonacci-catalogue";
import { ApiError } from "@/lib/assistant-api";
import { FIB_DEGREES, FIB_TIMEFRAMES, type FibFilters } from "@/lib/fibonacci";
export function fibQuery(p: URLSearchParams, context = false) {
  const dimensions = [
    "stockId",
    "market",
    "wave",
    "structure",
    "degree",
    "timeframe",
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
    ...(context ? ["instrument"] : ["search","selection"]),
  ];
  if ([...p.keys()].some((k) => !allowed.includes(k)))
    throw new ApiError(400, "Unbekannter Filter.");
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = p.get(key),
      n = raw === null ? fallback : Number(raw);
    if (
      (raw !== null && !/^\d+$/.test(raw)) ||
      !Number.isSafeInteger(n) ||
      n < min ||
      n > max
    )
      throw new ApiError(400, `Ungültiger Filter: ${key}.`);
    return n;
  };
  for (const [key, options] of Object.entries({
    structure: [...STRUCTURES.map(([c])=>c),...new Set(STRUCTURES.map(([, ,p])=>`family:${p}`))],
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
      throw new ApiError(400, `Unbekannter Filterwert: ${key}.`);
  if (p.has("wave") && (!p.get("wave")!.trim() || p.get("wave")!.length > 40))
    throw new ApiError(400, "Ungültiges Wellenlabel.");
  for (const key of ["from", "to"]) {
    const d = p.get(key);
    if (
      d !== null &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(d) ||
        !Number.isFinite(Date.parse(d)) ||
        new Date(d).toISOString().slice(0, 10) !== d)
    )
      throw new ApiError(400, "Ungültiges Datum.");
  }
  if (p.get("from") && p.get("to") && p.get("from")! > p.get("to")!)
    throw new ApiError(400, "Zeitraum ist umgekehrt.");
  if (
    p.has("contextId") &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      p.get("contextId")!,
    )
  )
    throw new ApiError(400, "Ungültige Wellenkontext-ID.");
  if (
    p.has("sourceKey") &&
    (!p.get("sourceKey")!.trim() || p.get("sourceKey")!.length > 200)
  )
    throw new ApiError(400, "Ungültige Quellenkennung.");
  const filters = Object.fromEntries(
    dimensions
      .filter((k) => p.has(k))
      .map((k) => [
        k,
        k === "stockId" ? integer(k, 0, 1, 2147483647) : p.get(k)!,
      ]),
  ) as FibFilters;
  const search = p.get("search") ?? "";
  const selection = p.get("selection") ?? "all";
  if (search.length > 2000 || !["all","missing","running","completed"].includes(selection)) throw new ApiError(400,"Ungültige Suche/Arbeitsauswahl.");
  return {
    search,
    selection: selection as import("@/lib/fibonacci-workspace").ResearchSelection,
    filters,
    limit: integer("limit", 100, 1, 500),
    offset: integer("offset", 0, 0, 1000000),
  };
}
