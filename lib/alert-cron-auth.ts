import { timingSafeEqual } from 'node:crypto'

export function alertCronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false
  const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(header)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
