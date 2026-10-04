import { describe, expect, it } from 'vitest'
import { pruefBeginn, completedDemoCandles, demoCoveragePrefix } from './demo-progress'
import type { trade } from './db/schema'
import type { TradeEventRow } from './trade-events'
import type { Candle } from './market-data/types'

const date = (value: string) => new Date(`2026-10-02T${value}:00Z`)
const row = (patch: Partial<typeof trade.$inferSelect> = {}) => ({
  createdAt: date('09:00'), openedAt: date('10:00'),
  demoCheckedAt: null, demoBoundaryAt: null, ...patch,
}) as typeof trade.$inferSelect
const event = (type: string, at: Date) => ({ type, at }) as TradeEventRow
const candle = (at: Date, patch: Partial<Candle> = {}): Candle => ({
  time: at.getTime() / 1000, open: 100, high: 110, low: 95, close: 100, volume: 1, ...patch,
})

describe('Dauerhafter Demo-Prüfstand', () => {
  it('holt auch ältere ungeprüfte Historie nach statt nach zwei Stunden abzuschneiden', () => {
    expect(pruefBeginn(row({ createdAt: new Date('2026-09-01'), openedAt: null }), []).beginn)
      .toEqual(new Date('2026-09-01'))
  })
  it('nimmt den gespeicherten Prüfstand auch ohne neues Handelsereignis', () => {
    expect(pruefBeginn(row({ demoCheckedAt: date('12:00') }), []).beginn).toEqual(date('12:00'))
  })
  it('eine Notiz überspringt keine ungeprüften Kerzen', () => {
    expect(pruefBeginn(row(), [event('notiz', date('12:00'))]).beginn).toEqual(date('10:00'))
  })
  it('eine manuelle Planänderung gilt erst ab ihrer neuen Grenze', () => {
    expect(pruefBeginn(row({ demoCheckedAt: date('11:00'), demoBoundaryAt: date('11:32') }), []).beginn)
      .toEqual(date('11:32'))
  })
  it('berücksichtigt alte manuelle Änderungen ohne gespeicherten Prüfstand', () => {
    expect(pruefBeginn(row(), [event('teilverkauf', date('11:10')), event('notiz', date('12:00'))]).beginn)
      .toEqual(date('11:10'))
  })
})

describe('Abgeschlossene Kerzen und manuelle Grenzen', () => {
  it('prüft die laufende Kerze erst nach ihrem Ende', () => {
    const candles = [candle(date('11:55')), candle(date('12:00'))]
    expect(completedDemoCandles(candles, date('11:00'), date('12:03').getTime())).toEqual([candles[0]])
    expect(completedDemoCandles(candles, date('11:00'), date('12:05').getTime())).toEqual(candles)
  })
  it('wendet neue Levels nicht auf High/Low von vor einer Änderung innerhalb derselben Kerze an', () => {
    const candles = [candle(date('11:30')), candle(date('11:35'))]
    expect(completedDemoCandles(candles, date('11:32'), date('12:00').getTime())).toEqual([candles[1]])
  })
  it('liest eine vollständig geprüfte Kerze beim nächsten Lauf nicht erneut', () => {
    expect(completedDemoCandles([candle(date('11:55')), candle(date('12:00'))], date('12:00'), date('12:05').getTime()))
      .toEqual([candle(date('12:00'))])
  })
  it('lässt den Prüfstand bei ungültigen OHLC-Daten stehen', () => {
    expect(() => completedDemoCandles([candle(date('11:00'), { low: NaN })], date('10:00'), date('12:00').getTime()))
      .toThrow('Prüfstand bleibt unverändert')
  })
})

describe('Kurslücken', () => {
  it('verarbeitet den nachgewiesenen Anfang und stoppt vor einer fehlenden Intraday-Kerze', () => {
    const candles = [candle(date('11:00')), candle(date('11:10'))]
    expect(demoCoveragePrefix(candles, candle(date('10:55')), date('11:00'), 'aktien'))
      .toEqual({ usable: [candles[0]], gap: true })
  })
  it('behandelt geschlossene Börsensitzungen nicht als fehlende Intraday-Kerzen', () => {
    const friday = new Date('2026-10-02T15:55:00Z')
    const monday = new Date('2026-10-05T09:00:00Z')
    expect(demoCoveragePrefix([candle(monday)], candle(friday), friday, 'aktien').gap).toBe(false)
    expect(demoCoveragePrefix([candle(monday)], candle(friday), friday, 'krypto').gap).toBe(true)
  })
  it('bewertet fehlende Kerzen vor einer manuellen Grenze nicht gegen den neuen Plan', () => {
    expect(demoCoveragePrefix([candle(date('11:35'))], candle(date('11:00')), date('11:32'), 'aktien').gap).toBe(false)
  })
})


describe('Bestätigte Börsenöffnungszeiten', () => {
  it('wartet bei US-Aktien vor Handelsbeginn auf 09:30 New York', () => {
    const boundary = new Date('2026-08-07T09:06:36Z')
    const opening = candle(new Date('2026-08-07T13:30:00Z'))
    expect(demoCoveragePrefix([opening], null, boundary, 'aktien', 'NASDAQ').gap).toBe(false)
    expect(demoCoveragePrefix([opening], null, boundary, 'aktien').gap).toBe(true)
  })
  it('überspringt keine fehlende Kerze nach der Börsenöffnung', () => {
    const opening = new Date('2026-08-07T13:30:00Z')
    expect(demoCoveragePrefix([candle(new Date('2026-08-07T13:35:00Z'))], null, opening, 'aktien', 'NASDAQ').gap).toBe(true)
  })
  it('berücksichtigt Sommer- und Winterzeit', () => {
    const boundary = new Date('2026-12-01T13:00:00Z')
    expect(demoCoveragePrefix([candle(new Date('2026-12-01T14:30:00Z'))], null, boundary, 'aktien', 'NYSE').gap).toBe(false)
  })
  it('erlaubt die tägliche COMEX-Wartung, aber keine Lücke während des Handels', () => {
    const start = new Date('2026-08-05T21:00:00Z')
    expect(demoCoveragePrefix([candle(new Date('2026-08-05T22:00:00Z'))], null, start, 'rohstoffe', 'CMX').gap).toBe(false)
    expect(demoCoveragePrefix([candle(new Date('2026-08-05T22:05:00Z'))], null, start, 'rohstoffe', 'CMX').gap).toBe(true)
  })
})


it('nimmt bei Krypto auch mit falscher Börsenmetadaten keine täglichen Schließzeiten an', () => {
  const boundary = new Date('2026-08-07T09:05:00Z')
  expect(demoCoveragePrefix([candle(new Date('2026-08-07T13:30:00Z'))], null, boundary, 'krypto', 'NASDAQ').gap).toBe(true)
})
