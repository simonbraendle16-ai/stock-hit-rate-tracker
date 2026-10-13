/** Decimal input accepts German commas and decimal points, never a numeric prefix. */
export function formNumber(raw: string): number {
  const value = raw.trim()
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(value)) return NaN
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : NaN
}
