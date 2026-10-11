import type { Candle } from "@/lib/market-data/types";
import { FIB_TIMEFRAMES } from "@/lib/fibonacci";
export type HistoryInput = {
  stockId: number;
  interval: string;
  timezone: string;
  currency: string;
  source: string;
  origin: "csv" | "cache";
  candles: Candle[];
};
export type HistoryInfo = Omit<HistoryInput, "candles"> & {
  id: string;
  version: number;
  createdAt: string;
  count: number;
  from: number;
  to: number;
};
export type CsvColumns = {
  time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
};
export function csvRows(text: string): string[][] {
  if (text.length > 8_000_000) throw new Error("CSV ist größer als 8 MB.");
  text = text.replace(/^\uFEFF/, "");
  const delimiter =
    (text.split(/\r?\n/, 1)[0].match(/;/g)?.length ?? 0) >
    (text.split(/\r?\n/, 1)[0].match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === delimiter || c === "\n" || c === "\r")) {
      row.push(cell.trim());
      cell = "";
      if (c !== delimiter) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
      }
    } else cell += c;
  }
  if (quoted) throw new Error("Nicht geschlossenes CSV-Anführungszeichen.");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length || new Set(rows[0]).size !== rows[0].length)
    throw new Error("Eindeutige Spaltenüberschriften erforderlich.");
  return rows;
}
export function utcTime(value: string, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  if (/^\d{9,10}$/.test(value)) return Number(value);
  const day = value.slice(0, 10);
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    (!Number.isFinite(Date.parse(day)) ||
      new Date(day).toISOString().slice(0, 10) !== day)
  )
    throw new Error("Ungültiges Datum.");
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) {
    const n = Date.parse(value);
    if (Number.isFinite(n)) return n / 1000;
    throw new Error("Ungültiger Zeitpunkt.");
  }
  const local = value
    .replace(" ", "T")
    .replace(/^(\d{4}-\d{2}-\d{2})$/, "$1T00:00:00")
    .replace(/T(\d{2}:\d{2})$/, "T$1:00");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local))
    throw new Error("ISO-Datum oder Unix-Sekunden erforderlich.");
  const naive = Date.parse(local + "Z");
  if (
    !Number.isFinite(naive) ||
    new Date(naive).toISOString().slice(0, 19) !== local
  )
    throw new Error("Ungültiges Datum.");
  const candidates = new Set<number>();
  for (const shift of [-36, 0, 36]) {
    const seed = naive + shift * 3600000;
    const rendered = fmt.format(new Date(seed)).replace(" ", "T");
    const offset = Date.parse(rendered + "Z") - seed;
    const candidate = naive - offset;
    if (fmt.format(new Date(candidate)).replace(" ", "T") === local)
      candidates.add(candidate / 1000);
  }
  if (candidates.size !== 1)
    throw new Error(
      "Zeitpunkt in dieser Zeitzone fehlt oder ist mehrdeutig; UTC-Offset angeben.",
    );
  return [...candidates][0];
}
export function validateHistory(raw: HistoryInput): HistoryInput {
  if (!Number.isSafeInteger(raw.stockId) || raw.stockId <= 0)
    throw new Error("Instrument erforderlich.");
  if (
    !(FIB_TIMEFRAMES as readonly string[]).includes(raw.interval) ||
    raw.interval === "unbekannt"
  )
    throw new Error("Bekanntes Intervall erforderlich.");
  for (const key of ["timezone", "currency", "source"] as const)
    if (
      typeof raw[key] !== "string" ||
      !raw[key].trim() ||
      raw[key].length > (key === "source" ? 2000 : 100)
    )
      throw new Error("Quelle, Zeitzone und Währung erforderlich.");
  new Intl.DateTimeFormat("de", { timeZone: raw.timezone });
  if (!["csv", "cache"].includes(raw.origin))
    throw new Error("Ungültige Herkunft.");
  if (
    !Array.isArray(raw.candles) ||
    !raw.candles.length ||
    raw.candles.length > 20000
  )
    throw new Error("1 bis 20.000 Kerzen je Datensatz erforderlich.");
  const unique = new Map<number, Candle>();
  for (const [i, c] of raw.candles.entries()) {
    if (
      !c ||
      ![c.time, c.open, c.high, c.low, c.close, c.volume].every(
        Number.isFinite,
      ) ||
      !Number.isSafeInteger(c.time) ||
      c.time < 0 ||
      c.time > Date.now() / 1000 ||
      Math.min(c.open, c.high, c.low, c.close) <= 0 ||
      c.volume < 0 ||
      c.low > Math.min(c.open, c.close) ||
      c.high < Math.max(c.open, c.close) ||
      c.low > c.high
    )
      throw new Error(`Ungültige Kerze in Zeile ${i + 2}.`);
    const normalized = {
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    };
    const previous = unique.get(c.time);
    if (previous && JSON.stringify(previous) !== JSON.stringify(normalized))
      throw new Error(
        `Widersprüchlicher doppelter Zeitpunkt in Zeile ${i + 2}.`,
      );
    unique.set(c.time, normalized);
  }
  return {
    stockId: raw.stockId,
    interval: raw.interval,
    timezone: raw.timezone,
    currency: raw.currency.trim().toUpperCase(),
    source: raw.source.trim(),
    origin: raw.origin,
    candles: [...unique.values()].sort((a, b) => a.time - b.time),
  };
}
export function parseHistoryCsv(
  text: string,
  columns: CsvColumns,
  meta: Omit<HistoryInput, "candles" | "origin">,
): HistoryInput {
  const [headers, ...rows] = csvRows(text);
  const mapped = [
    columns.time,
    columns.open,
    columns.high,
    columns.low,
    columns.close,
    ...(columns.volume ? [columns.volume] : []),
  ];
  if (new Set(mapped).size !== mapped.length)
    throw new Error("Jede Kursdimension benötigt eine eigene Spalte.");
  const index = (key: keyof CsvColumns) => {
    const name = columns[key];
    const i = name ? headers.indexOf(name) : -1;
    if (i < 0 && key !== "volume") throw new Error(`Spalte fehlt: ${key}.`);
    return i;
  };
  const indexes = Object.fromEntries(
    ["time", "open", "high", "low", "close", "volume"].map((k) => [
      k,
      index(k as keyof CsvColumns),
    ]),
  ) as Record<keyof CsvColumns, number>;
  const candles = rows.map((row, i) => {
    try {
      if (row.length !== headers.length)
        throw new Error("Spaltenzahl stimmt nicht.");
      const n = (key: keyof CsvColumns) => {
        if (key === "volume" && indexes[key] < 0) return 0;
        const v = row[indexes[key]];
        if (!v) throw new Error(`Leerer Wert: ${key}.`);
        const number = Number(v.replace(",", "."));
        if (!Number.isFinite(number))
          throw new Error(`Ungültige Zahl: ${key}.`);
        return number;
      };
      return {
        time: utcTime(row[indexes.time], meta.timezone),
        open: n("open"),
        high: n("high"),
        low: n("low"),
        close: n("close"),
        volume: n("volume"),
      };
    } catch (e) {
      throw new Error(`Zeile ${i + 2}: ${(e as Error).message}`);
    }
  });
  return validateHistory({ ...meta, origin: "csv", candles });
}
export function historyCoverage(candles: Candle[], interval: string) {
  const seconds: Record<string, number> = {
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "2h": 7200,
    "4h": 14400,
    "1d": 86400,
    "1w": 604800,
  };
  const step = seconds[interval];
  return {
    count: candles.length,
    from: candles[0]?.time ?? null,
    to: candles.at(-1)?.time ?? null,
    discontinuities: step
      ? candles.slice(1).filter((c, i) => c.time - candles[i].time > step * 1.5)
          .length
      : null,
    note: "Zeitabstände können Handelspausen sein; Vollständigkeit ist damit nicht belegt.",
  };
}
