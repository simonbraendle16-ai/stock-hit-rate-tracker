import { describe, it, expect } from "vitest";
import {
  parseHistoryCsv,
  utcTime,
  validateHistory,
  csvRows,
  historyCoverage,
} from "./fibonacci-history";
const meta = {
  stockId: 1,
  interval: "1d",
  timezone: "Europe/Berlin",
  currency: "eur",
  source: "Synthetic adjusted prices",
};
const columns = { time: "Date", open: "O", high: "H", low: "L", close: "C" };
const csv =
  "Date;O;H;L;C\n2026-01-01 09:00;100;120;90;110\n2026-01-02 09:00;110;125;100;120";
describe("Research CSV without provider access", () => {
  it("maps columns, normalizes UTC and decimal commas, retains provenance", () => {
    const result = parseHistoryCsv(csv, columns, meta);
    expect(result.currency).toBe("EUR");
    expect(result.candles[0]).toEqual({
      time: Date.parse("2026-01-01T08:00:00Z") / 1000,
      open: 100,
      high: 120,
      low: 90,
      close: 110,
      volume: 0,
    });
    expect(
      parseHistoryCsv(csv.replace(";110\n", ";110,5\n"), columns, meta)
        .candles[0].close,
    ).toBe(110.5);
  });
  it("rejects DST ambiguity and nonexistent local times rather than guessing", () => {
    expect(() => utcTime("2026-03-29 02:30", "Europe/Berlin")).toThrow();
    expect(() => utcTime("2025-10-26 02:30", "Europe/Berlin")).toThrow();
    expect(utcTime("2025-10-26T02:30:00+02:00", "Europe/Berlin")).toBe(
      Date.parse("2025-10-26T00:30:00Z") / 1000,
    );
  });
  it("handles BOM, quoted delimiters, Unix seconds and missing optional volume", () => {
    expect(csvRows('\uFEFFDate;"Source;name"\r\n2026-01-01;"a""b"')).toEqual([
      ["Date", "Source;name"],
      ["2026-01-01", 'a"b'],
    ]);
    expect(utcTime("1767225600", "UTC")).toBe(1767225600);
  });
  it("rejects malformed columns, prices, empty numeric cells and future dates", () => {
    for (const text of [
      csv.replace(";120;", ";80;"),
      csv.replace(";110\n", ";\n"),
      csv.replace("2026-01-01", "2026-02-30"),
      csv.replace("2026-01-01", "2099-01-01"),
    ])
      expect(() => parseHistoryCsv(text, columns, meta)).toThrow();
    expect(() =>
      parseHistoryCsv(csv, { ...columns, high: "missing" }, meta),
    ).toThrow();
  });
  it("collapses identical duplicate candles but rejects conflicting duplicates", () => {
    const a = parseHistoryCsv(csv, columns, meta);
    expect(
      validateHistory({ ...a, candles: [...a.candles, a.candles[0]] }).candles,
    ).toHaveLength(2);
    expect(() =>
      validateHistory({
        ...a,
        candles: [...a.candles, { ...a.candles[0], close: 111 }],
      }),
    ).toThrow(/doppelter/);
  });
  it("shows time discontinuities without inventing missing trading sessions", () => {
    const a = parseHistoryCsv(csv, columns, meta);
    expect(historyCoverage(a.candles, "1d").discontinuities).toBe(0);
    expect(historyCoverage(a.candles, "1h").discontinuities).toBe(1);
  });
});

it("measures two-hour gaps without treating consecutive two-hour candles as missing", () => {
  const candles=[{time:1767225600,open:100,high:110,low:95,close:105,volume:1000},{time:1767232800,open:105,high:115,low:100,close:112,volume:1200}];
  expect(historyCoverage(candles,"2h").discontinuities).toBe(0);
  expect(historyCoverage([candles[0],{...candles[1],time:1767247200}],"2h").discontinuities).toBe(1);
});
