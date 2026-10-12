/** Kursalter aus Unix-Sekunden des Kursstands, niemals aus der Abrufzeit. */
export function quoteAge(quotedAt: number | null | undefined, now = Date.now()): {
  short: string
  long: string
} {
  const ageMs = typeof quotedAt === 'number' ? now - quotedAt * 1000 : NaN
  if (!quotedAt || quotedAt <= 0 || !Number.isFinite(ageMs) || ageMs < 0) {
    return { short: 'Kurszeit unbekannt', long: 'Kurszeit unbekannt' }
  }
  const minutes = Math.floor(ageMs / 60000)
  if (minutes < 1) return { short: 'eben', long: 'gerade eben' }
  if (minutes < 60) return { short: `${minutes} Min.`, long: `vor ${minutes} Min.` }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { short: `${hours} Std.`, long: `vor ${hours} Std.` }
  const days = Math.floor(hours / 24)
  return { short: `${days} Tg.`, long: `vor ${days} Tg.` }
}
