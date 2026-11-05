/** Admit scheduled maintenance in one five-minute delivery window per quarter hour.
 * Pure clock check: rejected deliveries must not touch database-backed activity gates.
 * Existing authentication and explicit manual paths stay outside this helper. */
export const MAINTENANCE_INTERVAL_MINUTES = 15
export function maintenanceWindowOpen(now = Date.now()): boolean {
  return Number.isFinite(now) && Math.floor(now / 300_000) % 3 === 0
}
