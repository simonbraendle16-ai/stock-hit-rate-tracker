export type JournalKind = 'user_note' | 'assistant_interpretation'
export type InsightStatus = 'hypothesis' | 'supported' | 'contradicted' | 'discarded'
export type EvidenceRef = { kind: 'trade' | 'journal'; id: string }

export type JournalInput = {
  tradeId?: number | null
  occurredAt?: string
  kind?: JournalKind
  situation: string
  intention?: string | null
  action?: string | null
  thoughts?: string | null
  reflection?: string | null
  ruleRef?: string | null
  sourceRefs?: string[]
}

export type InsightInput = {
  statement: string
  area?: string | null
  status?: InsightStatus
  evidenceRefs?: EvidenceRef[]
  counterEvidenceRefs?: EvidenceRef[]
  limits?: string | null
  proposal?: string | null
}

function clean(value: string | null | undefined, name: string, max: number): string | null {
  if (value == null) return null
  if (typeof value !== 'string') throw new Error(`${name} muss Text sein.`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new Error(`${name} ist zu lang (maximal ${max} Zeichen).`)
  return trimmed || null
}

export function normalizeJournalInput(input: JournalInput) {
  if (!input || typeof input !== 'object') throw new Error('Journalangaben fehlen.')
  const situation = clean(input.situation, 'Situation', 4000)
  if (!situation) throw new Error('Eine Situation ist erforderlich.')
  if (input.tradeId != null && (!Number.isSafeInteger(input.tradeId) || input.tradeId <= 0)) {
    throw new Error('Ungültige Trade-ID.')
  }
  const kind = input.kind ?? 'user_note'
  if (kind !== 'user_note' && kind !== 'assistant_interpretation') {
    throw new Error('Unbekannte Notizart.')
  }
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date()
  if (!Number.isFinite(occurredAt.getTime())) throw new Error('Ungültiger Zeitpunkt.')
  const sourceRefs = input.sourceRefs ?? []
  if (!Array.isArray(sourceRefs) || sourceRefs.length > 20 ||
      sourceRefs.some((ref) => typeof ref !== 'string' || ref.length > 500)) {
    throw new Error('Ungültige Quellenverweise.')
  }
  return {
    tradeId: input.tradeId ?? null,
    occurredAt,
    kind,
    situation,
    intention: clean(input.intention, 'Absicht', 4000),
    action: clean(input.action, 'Handlung', 4000),
    thoughts: clean(input.thoughts, 'Gedanken', 8000),
    reflection: clean(input.reflection, 'Reflexion', 8000),
    ruleRef: clean(input.ruleRef, 'Regelbezug', 500),
    sourceRefs: sourceRefs.map((ref) => ref.trim()).filter(Boolean),
  }
}

function normalizeEvidenceRefs(refs: EvidenceRef[] | undefined, label: string) {
  if (refs == null) return []
  if (!Array.isArray(refs) || refs.length > 30) throw new Error(`${label}: zu viele Verweise.`)
  const seen = new Set<string>()
  return refs.map((ref) => {
    if (!ref || (ref.kind !== 'trade' && ref.kind !== 'journal') || typeof ref.id !== 'string') {
      throw new Error(`${label}: ungültiger Verweis.`)
    }
    const id = ref.id.trim()
    if (ref.kind === 'trade' ? !/^[1-9]\d*$/.test(id) : !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error(`${label}: ungültige ID.`)
    }
    const key = `${ref.kind}:${id}`
    if (seen.has(key)) throw new Error(`${label}: doppelter Verweis.`)
    seen.add(key)
    return { kind: ref.kind, id }
  })
}

export function normalizeInsightInput(input: InsightInput) {
  if (!input || typeof input !== 'object') throw new Error('Erkenntnisangaben fehlen.')
  const statement = clean(input.statement, 'Aussage', 4000)
  if (!statement) throw new Error('Eine Aussage ist erforderlich.')
  const status = input.status ?? 'hypothesis'
  if (!['hypothesis', 'supported', 'contradicted', 'discarded'].includes(status)) {
    throw new Error('Unbekannter Erkenntnisstatus.')
  }
  const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs, 'Belege')
  const counterEvidenceRefs = normalizeEvidenceRefs(input.counterEvidenceRefs, 'Gegenbelege')
  if (status === 'supported' && evidenceRefs.length === 0) {
    throw new Error('Eine gestützte Erkenntnis braucht mindestens einen Beleg.')
  }
  return {
    statement,
    area: clean(input.area, 'Lernbereich', 200),
    status,
    evidenceRefs,
    counterEvidenceRefs,
    limits: clean(input.limits, 'Einschränkungen', 4000),
    proposal: clean(input.proposal, 'Vorschlag', 4000),
  }
}
