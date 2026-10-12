/** Only deliberate, user-facing validation messages may cross the action boundary. */
export class TradeInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TradeInputError'
  }
}

export type CreateTradeResult =
  | { ok: true; id: number; deckungsHinweis: string | null; planReady: boolean }
  | { ok: false; message: string; reference?: string }

export function tradeCreationFailure(error: unknown, reference: string): Extract<CreateTradeResult, { ok: false }> {
  return error instanceof TradeInputError
    ? { ok: false, message: error.message }
    : { ok: false, message: `Der Trade konnte nicht gespeichert werden. Fehlerreferenz: ${reference}.`, reference }
}
