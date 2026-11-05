/** Expected scheduling gates, never provider or database failures. */
export class AutomaticCandleDeferred extends Error {
  constructor(public readonly reason: 'phase' | 'lease' | 'retry' | 'hour' | 'priority' | 'minute' | 'day', message: string) {
    super(message); this.name = 'AutomaticCandleDeferred'
  }
}

/** Invocation-local coordination only. Persisted reservations remain authoritative
 * across phases, callers and processes. A failed provider attempt uses its slot. */
export class AutomaticCandlePlan {
  private limitedKey: string | null = null
  get limitedUsed() { return this.limitedKey !== null }
  fetched = 0
  reused = 0
  assertAvailable(key: string) {
    if (key.startsWith('twelvedata|') && this.limitedKey !== null && this.limitedKey !== key)
      throw new AutomaticCandleDeferred('phase', 'Begrenzte Reihe für die nächste Sammelphase vorgemerkt.')
  }
  reserved(key: string) { if (key.startsWith('twelvedata|')) this.limitedKey = key }
}
