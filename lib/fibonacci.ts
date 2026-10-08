export const FIB_LEVELS = [
  0, 23.6, 38.2, 50, 61.8, 78.6, 100, 127.2, 161.8, 200, 261.8, 423.6,
] as const
export const FIB_WAVES = ['2', '4', 'A', 'B', 'C', 'X', 'Y'] as const
export const FIB_DEGREES = [
  'GrandSupercycle',
  'Supercycle',
  'Zyklus',
  'Primär',
  'Intermediär',
  'Minor',
  'Minute',
  'Minuette',
  'Subminuette',
] as const
export const FIB_TIMEFRAMES = [
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  '1d',
  '1w',
  '1M',
] as const
export type FibInput = {
  stockId: number
  wave: string
  degree: string
  timeframe: string
  observedOn: string
  status: 'laufend' | 'abgeschlossen' | 'ungueltig'
  percent: number
  anchorStart: number | null
  anchorEnd: number | null
  extreme: number | null
  note: string
}
export type FibObservation = FibInput & {
  id: string
  version: number
  ticker: string
  name: string
  market: string
}
export class FibonacciError extends Error {}
const fail = (message: string): never => {
  throw new FibonacciError(message)
}
export function retracement(start: number, end: number, extreme: number) {
  if (
    ![start, end, extreme].every((n) => Number.isFinite(n) && n > 0) ||
    start === end
  )
    return fail(
      'Positive Preise und unterschiedliche Referenzanker erforderlich.',
    )
  const value = ((end - extreme) / (end - start)) * 100
  if (!Number.isFinite(value) || value < 0 || value > 500)
    return fail('Retracement muss zwischen 0 und 500 % liegen.')
  return value
}
export function validateFibInput(raw: Record<string, unknown>): FibInput {
  const keys = [
    'stockId',
    'wave',
    'degree',
    'timeframe',
    'observedOn',
    'status',
    'percent',
    'anchorStart',
    'anchorEnd',
    'extreme',
    'note',
  ]
  if (Object.keys(raw).some((k) => !keys.includes(k)))
    return fail('Unbekanntes Eingabefeld.')
  if (!Number.isSafeInteger(raw.stockId) || Number(raw.stockId) <= 0)
    return fail('Instrument erforderlich.')
  for (const [key, options] of [
    ['wave', FIB_WAVES],
    ['degree', FIB_DEGREES],
    ['timeframe', FIB_TIMEFRAMES],
    ['status', ['laufend', 'abgeschlossen', 'ungueltig']],
  ] as const) {
    if (
      typeof raw[key] !== 'string' ||
      !(options as readonly string[]).includes(raw[key] as string)
    )
      return fail(`Ungültige Angabe: ${key}.`)
  }
  const date = raw.observedOn
  if (
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date ||
    date > new Date().toISOString().slice(0, 10)
  )
    return fail('Gültiges Beobachtungsdatum bis heute erforderlich.')
  const prices = [raw.anchorStart, raw.anchorEnd, raw.extreme]
  const hasPrices = prices.some((v) => v != null)
  let percent = raw.percent
  if (hasPrices) {
    if (!prices.every((v) => typeof v === 'number' && Number.isFinite(v)))
      return fail('Alle drei Ankerpreise angeben.')
    const computed = retracement(
      prices[0] as number,
      prices[1] as number,
      prices[2] as number,
    )
    if (
      percent != null &&
      (typeof percent !== 'number' || Math.abs(percent - computed) > 0.01)
    )
      return fail('Prozentangabe widerspricht den Ankern.')
    percent = computed
  }
  if (
    typeof percent !== 'number' ||
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 500
  )
    return fail('Retracement muss zwischen 0 und 500 % liegen.')
  if (
    typeof raw.note !== 'string' ||
    !raw.note.trim() ||
    raw.note.length > 2000
  )
    return fail('Messnotiz/Quelle erforderlich (maximal 2000 Zeichen).')
  return {
    stockId: raw.stockId as number,
    wave: raw.wave as string,
    degree: raw.degree as string,
    timeframe: raw.timeframe as string,
    observedOn: date,
    status: raw.status as FibInput['status'],
    percent,
    anchorStart: hasPrices ? (prices[0] as number) : null,
    anchorEnd: hasPrices ? (prices[1] as number) : null,
    extreme: hasPrices ? (prices[2] as number) : null,
    note: raw.note.trim(),
  }
}
export function fibZone(value: number) {
  // Halfway ties go to the higher reference level. Values beyond the final
  // midpoint remain in the final zone; exact depths remain available separately.
  for (let i = 0; i < FIB_LEVELS.length - 1; i++)
    if (value < (FIB_LEVELS[i] + FIB_LEVELS[i + 1]) / 2) return i
  return FIB_LEVELS.length - 1
}
function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null
  const position = (sorted.length - 1) * q,
    lo = Math.floor(position),
    fraction = position - lo
  return sorted[lo] + fraction * ((sorted[lo + 1] ?? sorted[lo]) - sorted[lo])
}
export function fibStats(rows: readonly FibObservation[]) {
  const completed = rows.filter(
    (r) =>
      r.status === 'abgeschlossen' &&
      Number.isFinite(r.percent) &&
      r.percent >= 0 &&
      r.percent <= 500,
  )
  const values = completed.map((r) => r.percent).sort((a, b) => a - b),
    n = values.length
  const zones = FIB_LEVELS.map((level, i) => ({
    level,
    lower: i === 0 ? 0 : (FIB_LEVELS[i - 1] + level) / 2,
    upper: i === FIB_LEVELS.length - 1 ? 500 : (level + FIB_LEVELS[i + 1]) / 2,
    count: 0,
    reached: 0,
  }))
  for (const value of values) {
    zones[fibZone(value)].count++
    for (const z of zones) if (value + 1e-9 >= z.level) z.reached++
  }
  const max = Math.max(0, ...zones.map((z) => z.count))
  return {
    n,
    running: rows.filter((r) => r.status === 'laufend').length,
    invalid: rows.filter((r) => r.status === 'ungueltig').length,
    mean: n ? values.reduce((a, b) => a + b, 0) / n : null,
    median: quantile(values, 0.5),
    q1: quantile(values, 0.25),
    q3: quantile(values, 0.75),
    modes: max ? zones.filter((z) => z.count === max).map((z) => z.level) : [],
    zones,
    exploratory: n < 10,
  }
}
export type FibFilters = {
  stockId?: number
  market?: string
  wave?: string
  degree?: string
  timeframe?: string
  from?: string
  to?: string
}
export function filterFib(
  rows: readonly FibObservation[],
  filters: FibFilters,
) {
  return rows.filter(
    (r) =>
      (!filters.stockId || r.stockId === filters.stockId) &&
      (!filters.market || r.market === filters.market) &&
      (!filters.wave || r.wave === filters.wave) &&
      (!filters.degree || r.degree === filters.degree) &&
      (!filters.timeframe || r.timeframe === filters.timeframe) &&
      (!filters.from || r.observedOn >= filters.from) &&
      (!filters.to || r.observedOn <= filters.to),
  )
}
export function fibCsv(rows: readonly FibObservation[]) {
  const cell = (v: unknown) =>
    '"' +
    String(v ?? '')
      .replaceAll('"', '""')
      .replace(/^[\s]*[=+\-@]|^[\t\r]/, "'$&") +
    '"'
  return (
    '\uFEFF' +
    [
      [
        'ID',
        'Instrument',
        'Ticker',
        'Markt',
        'Welle',
        'Wellengrad',
        'Zeiteinheit',
        'Datum',
        'Status',
        'Retracement %',
        'Anfang',
        'Ende',
        'Extrem',
        'Messnotiz',
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
        r.anchorStart,
        r.anchorEnd,
        r.extreme,
        r.note,
      ]),
    ]
      .map((row) => row.map(cell).join(';'))
      .join('\r\n')
  )
}
