import { describe, expect, it } from 'vitest'
import {
  generateInviteCode,
  normalizeInviteCode,
  inviteExpiry,
  isInviteExpired,
  projectFriendTrades,
  toFriendSummary,
  INVITE_CODE_LENGTH,
  INVITE_TTL_MS,
} from './friends'
import type { DisciplineStats, TradeRow } from './trade-stats'

/** Minimaler abgeschlossener Gewinn-Trade; Felder je Test überschreiben. */
function makeTrade(over: Partial<TradeRow> = {}): TradeRow {
  return {
    id: 1,
    userId: 'u1',
    stockId: null,
    ticker: 'TEST',
    market: 'aktien',
    direction: 'long',
    entryPrice: 100,
    stopLoss: 90,
    takeProfit: 120,
    positionSize: 10,
    investedAmount: 1000,
    leverage: 1,
    feeEntry: 0,
    feeExit: 0,
    takeProfitPct: 100,
    strategy: null,
    broker: null,
    riskRewardRatio: 2,
    notes: null,
    status: 'abgeschlossen',
    elliottWaveCount: null,
    waveDegree: null,
    elliottInvalidation: null,
    preTradeAnswered: true,
    preTradeAnswers: null,
    tradedWithMoney: true,
    followedPlan: true,
    ruleViolations: null,
    lossAccepted: false,
    moodEntry: null,
    moodEntryTags: null,
    moodEntryNote: null,
    moodExit: null,
    moodExitTags: null,
    moodExitNote: null,
    result: 'gewinn',
    actualExitPrice: 120,
    noTradeNote: null,
    openedAt: new Date('2026-01-01'),
    closedAt: new Date('2026-01-02'),
    createdAt: new Date('2026-01-01'),
    ...over,
  } as TradeRow
}

describe('generateInviteCode', () => {
  it('hat die feste Länge und nur Zeichen aus dem eindeutigen Alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode()
      expect(code).toHaveLength(INVITE_CODE_LENGTH)
      // keine verwechselbaren Zeichen 0/O/1/I/L, keine Kleinbuchstaben
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/)
    }
  })

  it('ist mit injizierter rng deterministisch', () => {
    const rng = () => 0 // immer das erste Zeichen des Alphabets ('A')
    expect(generateInviteCode(rng)).toBe('AAAAAAAA')
  })
})

describe('normalizeInviteCode', () => {
  it('trimmt, macht groß und entfernt Trenner', () => {
    expect(normalizeInviteCode('  ab2-cd3f ')).toBe('AB2CD3F')
    expect(normalizeInviteCode('a b c')).toBe('ABC')
  })
})

describe('inviteExpiry / isInviteExpired', () => {
  it('setzt den Ablauf um genau die TTL in die Zukunft', () => {
    const from = new Date('2026-07-24T00:00:00Z')
    expect(inviteExpiry(from).getTime()).toBe(from.getTime() + INVITE_TTL_MS)
  })

  it('erkennt abgelaufen erst ab Erreichen des Zeitpunkts', () => {
    const exp = new Date('2026-07-24T12:00:00Z')
    expect(isInviteExpired(exp, new Date('2026-07-24T11:59:59Z'))).toBe(false)
    expect(isInviteExpired(exp, new Date('2026-07-24T12:00:00Z'))).toBe(true)
    expect(isInviteExpired(exp, new Date('2026-07-24T12:00:01Z'))).toBe(true)
  })
})

describe('projectFriendTrades', () => {
  it('zeigt abgeschlossene UND geplante Trades — aktive/abgebrochene bleiben verborgen', () => {
    const rows = [
      makeTrade({ id: 1, status: 'abgeschlossen' }),
      makeTrade({ id: 2, status: 'aktiv', result: null, actualExitPrice: null }),
      makeTrade({ id: 3, status: 'geplant', result: null, actualExitPrice: null }),
      makeTrade({ id: 4, status: 'abgebrochen', result: null, actualExitPrice: null }),
    ]
    const out = projectFriendTrades(rows)
    expect(out.map((t) => t.id).sort()).toEqual([1, 3])
  })

  it('nimmt geplante Trades ohne P&L mit — mit Status geplant, ohne realisiertes R', () => {
    // Einstieg 100, Stop 90, Ziel 120 → geplantes CRV = 30/10 = 2, kein realisiertes R
    const [t] = projectFriendTrades([
      makeTrade({ id: 7, status: 'geplant', result: null, actualExitPrice: null }),
    ])
    expect(t.status).toBe('geplant')
    expect(t.result).toBeNull()
    expect(t.r).toBeNull()
    expect(t.plannedRR).toBeCloseTo(2, 6)
  })

  it('überspringt abgeschlossene Trades ohne berechenbaren P&L', () => {
    const rows = [makeTrade({ id: 1, result: 'gewinn', actualExitPrice: null })]
    expect(projectFriendTrades(rows)).toHaveLength(0)
  })

  it('projiziert Long-Gewinn auf das korrekte R-Vielfache und trägt keinen Betrag', () => {
    // Einstieg 100, Stop 90 → Risiko 10/Stück; Ausstieg 120 → +20/Stück = +2 R
    const [t] = projectFriendTrades([makeTrade({ direction: 'long', actualExitPrice: 120 })])
    expect(t.r).toBeCloseTo(2, 6)
    expect(t.result).toBe('gewinn')
    expect(t.status).toBe('abgeschlossen')
    // Sicherheit: kein Geld-/Größenfeld ist durchgesickert
    expect(Object.keys(t).sort()).toEqual(
      [
        'closedAt',
        'createdAt',
        'direction',
        'followedPlan',
        'id',
        'market',
        'plannedRR',
        'r',
        'result',
        'status',
        'ticker',
      ].sort(),
    )
  })

  it('rechnet Short richtig herum (Kursverfall = Gewinn)', () => {
    // Short, Einstieg 100, Stop 110 → Risiko 10/Stück; Ausstieg 90 → +10/Stück = +1 R
    const [t] = projectFriendTrades([
      makeTrade({ direction: 'short', entryPrice: 100, stopLoss: 110, actualExitPrice: 90 }),
    ])
    expect(t.r).toBeCloseTo(1, 6)
  })

  it('sortiert geplante zuerst, dann abgeschlossene je Gruppe neueste zuerst', () => {
    const rows = [
      makeTrade({ id: 1, status: 'abgeschlossen', closedAt: new Date('2026-01-02') }),
      makeTrade({ id: 2, status: 'abgeschlossen', closedAt: new Date('2026-03-01') }),
      makeTrade({
        id: 3,
        status: 'geplant',
        result: null,
        actualExitPrice: null,
        createdAt: new Date('2026-02-10'),
      }),
      makeTrade({
        id: 4,
        status: 'geplant',
        result: null,
        actualExitPrice: null,
        createdAt: new Date('2026-02-20'),
      }),
    ]
    // geplante zuerst (4 vor 3, neuere createdAt), dann abgeschlossene (2 vor 1)
    expect(projectFriendTrades(rows).map((t) => t.id)).toEqual([4, 3, 2, 1])
  })
})

describe('toFriendSummary', () => {
  it('gibt ausschließlich die betragsfreien Felder weiter — kein Geldwert', () => {
    const full: DisciplineStats = {
      completed: 12,
      disciplineScore: 83.3,
      winRate: 55,
      expectancy: 0.42,
      streak: 4,
      ruleViolations: 1,
      totalPnL: 4213.5, // darf NICHT durchsickern
      startCapital: 10000, // darf NICHT durchsickern
      currentBalance: 14213.5, // darf NICHT durchsickern
      returnPct: 42.1, // darf NICHT durchsickern
      incomplete: 0,
    }
    const s = toFriendSummary(full)
    expect(Object.keys(s).sort()).toEqual(
      ['completed', 'disciplineScore', 'expectancy', 'ruleViolations', 'streak', 'winRate'].sort(),
    )
    // explizit: keines der Geldfelder ist vorhanden
    for (const forbidden of ['totalPnL', 'startCapital', 'currentBalance', 'returnPct']) {
      expect(forbidden in s).toBe(false)
    }
  })
})
