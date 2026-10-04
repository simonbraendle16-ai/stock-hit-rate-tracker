// Die Douglas-Fragen, die vor jedem Trade bewusst zu beantworten sind.
// Gemeinsame Quelle für den Dialog (Client) und das Gate in createTrade (Server),
// damit die Anzahl nie auseinanderläuft.
export const PRE_TRADE_QUESTIONS = [
  { key: 'perception', question: 'Hast du alle Informationen korrekt wahrgenommen?' },
  { key: 'wave', question: 'Ist deine Wellenzählung eindeutig?' },
  { key: 'indicators', question: 'Hast du bei der Aktie die Indikatorenlage geprüft und verglichen?' },
  { key: 'entry', question: 'Ist dein Einstieg klar definiert?' },
  { key: 'stop', question: 'Steht dein Stop-Loss fest?' },
  { key: 'target', question: 'Ist Ziel / Invalidation festgelegt?' },
  { key: 'risk', question: 'Ist dir dein Risiko bewusst?' },
  { key: 'emotions', question: 'Sind deine Emotionen ausgenommen?' },
  { key: 'responsibility', question: 'Wirst du die Verantwortung übernehmen, egal was passiert?' },
] as const

export type PreTradeAnswer = {
  key: string
  question: string
  answer: 'ja' | 'nein'
  note: string
}

/** Preserve actual answers; never infer consent from a boolean or duplicate keys. */
export function validatePreTradeAnswers(raw: unknown): PreTradeAnswer[] {
  if (raw == null) return []
  if (!Array.isArray(raw) || raw.length > PRE_TRADE_QUESTIONS.length) throw new Error('Vorabantworten sind ungültig.')
  const keys = new Set<string>()
  return raw.map(value => {
    if (!value || typeof value !== 'object') throw new Error('Vorabantworten sind ungültig.')
    const a = value as Record<string, unknown>
    const question = PRE_TRADE_QUESTIONS.find(q => q.key === a.key)
    if (!question || keys.has(question.key) || !['ja', 'nein'].includes(String(a.answer)) ||
        (a.question != null && a.question !== question.question) ||
        (a.note != null && (typeof a.note !== 'string' || a.note.length > 4000)) ||
        Object.keys(a).some(k => !['key', 'question', 'answer', 'note'].includes(k))) throw new Error('Vorabantworten sind ungültig oder doppelt.')
    keys.add(question.key)
    return { key: question.key, question: question.question, answer: a.answer as 'ja' | 'nein', note: (a.note as string | undefined) ?? '' }
  })
}
