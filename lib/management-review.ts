export type ManagementReview = {
  assessment: 'plan' | 'violation' | 'unknown'
  reason: string
}

/** Zeitliche Nähe ist ein Prüfhinweis, kein nachgewiesenes emotionales Motiv. */
export function hasRecentLoss(closedAt: Date | string | null | undefined, now: number): boolean {
  if (!closedAt) return false
  const elapsed = now - new Date(closedAt).getTime()
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 60 * 60 * 1000
}

/** Keine Planregel aus Richtung, Rendite oder einem vorherigen Teilverkauf ableiten. */
export function resolveManagementReview(raw: unknown, force = false): {
  violation: boolean | null
  assessment: ManagementReview['assessment']
  reason: string
  note: string
} {
  if (raw == null && force === true) {
    return { violation: true, assessment: 'violation', reason: 'Vom Nutzer ausdrücklich als Regelabweichung bestätigt (force).',
      note: 'Bestätigte Regelabweichung: ausdrücklich vom Nutzer bestätigt (force).' }
  }
  if (raw == null) return { violation: null, assessment: 'unknown', reason: 'Planbezug noch nicht geklärt.',
    note: 'Planbewertung offen; kein nachgewiesener Regelverstoß: Planbezug noch nicht geklärt.' }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Stop/Invalidierung geändert: bitte Planbezug, bestätigte Abweichung oder offene Bewertung mit Begründung angeben.')
  }
  const r = raw as Record<string, unknown>
  if (!['plan', 'violation', 'unknown'].includes(String(r.assessment)) ||
      typeof r.reason !== 'string' || !r.reason.trim() || r.reason.length > 4000 ||
      Object.keys(r).some(k => !['assessment', 'reason'].includes(k)) ||
      (force && r.assessment !== 'violation')) {
    throw new Error('Die Managementbewertung ist ungültig oder widersprüchlich.')
  }
  const assessment = r.assessment as ManagementReview['assessment']
  const reason = r.reason.trim()
  const prefix = { plan: 'Laut Nutzer planmäßig', violation: 'Vom Nutzer bestätigte Regelabweichung',
    unknown: 'Planbewertung offen; kein nachgewiesener Regelverstoß' }[assessment]
  return { violation: assessment === 'unknown' ? null : assessment === 'violation', assessment, reason,
    note: `${prefix}: ${reason}` }
}
