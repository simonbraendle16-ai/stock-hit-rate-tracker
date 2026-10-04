import { describe, expect, it } from 'vitest'
import { normalizeInsightInput, normalizeJournalInput } from './journal'

describe('Journal-Daten vor dem Speichern', () => {
  it('bewahrt den optionalen Trade-Bezug und die Worte des Nutzers', () => {
    const entry = normalizeJournalInput({
      tradeId: 52,
      situation: '  Beim Rücklauf wurde ich unruhig.  ',
      thoughts: 'Ich wollte früher aussteigen.',
    })
    expect(entry.tradeId).toBe(52)
    expect(entry.situation).toBe('Beim Rücklauf wurde ich unruhig.')
    expect(entry.thoughts).toBe('Ich wollte früher aussteigen.')
    expect(entry.reflection).toBeNull()
  })

  it('verwirft leere Situationen und ungültige Trade-IDs', () => {
    expect(() => normalizeJournalInput({ situation: '  ' })).toThrow('Situation')
    expect(() => normalizeJournalInput({ situation: 'Test', tradeId: -1 })).toThrow('Trade-ID')
  })
})

describe('Erkenntnisstatus und Belege', () => {
  it('erlaubt eine gestützte Aussage nur mit überprüfbarem Beleg', () => {
    expect(() => normalizeInsightInput({ statement: 'Frühe Ausstiege häufen sich', status: 'supported' }))
      .toThrow('Beleg')
    const insight = normalizeInsightInput({
      statement: 'Frühe Ausstiege häufen sich',
      status: 'supported',
      evidenceRefs: [{ kind: 'trade', id: '52' }],
    })
    expect(insight.evidenceRefs).toEqual([{ kind: 'trade', id: '52' }])
  })

  it('verhindert doppelte oder falsch geformte Verweise', () => {
    expect(() => normalizeInsightInput({
      statement: 'Test', evidenceRefs: [{ kind: 'trade', id: '52' }, { kind: 'trade', id: '52' }],
    })).toThrow('doppelter')
    expect(() => normalizeInsightInput({
      statement: 'Test', evidenceRefs: [{ kind: 'journal', id: 'fremde-id' }],
    })).toThrow('ungültige ID')
  })

  it('hält einen Verbesserungsvorschlag im Hypothesenstatus', () => {
    const insight = normalizeInsightInput({ statement: 'Stop früher prüfen', proposal: 'Plan ergänzen' })
    expect(insight.status).toBe('hypothesis')
    expect(insight.proposal).toBe('Plan ergänzen')
  })
})
