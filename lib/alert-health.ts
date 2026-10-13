/** A quote's source time, never its fetch time, decides whether it can trigger. */
export function usableAlertPrice(price: number, quotedAt: number, now = Date.now(), windowMs = 15 * 60_000): boolean {
  const age = now - quotedAt * 1000
  return Number.isFinite(price) && price > 0 && Number.isFinite(age) && age >= 0 && age <= windowMs
}

export function automaticCheckHealthy(input: { finishedAt: Date | null; complete: boolean; error: string | null; mailsFailed: number; quotesMissing: number }): boolean {
  return !!input.finishedAt && input.complete && !input.error && input.mailsFailed === 0 && input.quotesMissing === 0
}

/** Read-only work may time out; never race a write or a send against a timer. */
export async function boundedRead<T>(read: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([read, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Kursabruf überschreitet das Zeitbudget.')), Math.max(1, milliseconds))
    })])
  } finally { clearTimeout(timer) }
}
