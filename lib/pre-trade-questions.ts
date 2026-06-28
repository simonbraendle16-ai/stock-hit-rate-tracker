// Die Douglas-Fragen, die vor jedem Trade bewusst zu beantworten sind.
// Gemeinsame Quelle für den Dialog (Client) und das Gate in createTrade (Server),
// damit die Anzahl nie auseinanderläuft.
export const PRE_TRADE_QUESTIONS = [
  { key: 'wave', question: 'Ist deine Wellenzählung eindeutig?' },
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
