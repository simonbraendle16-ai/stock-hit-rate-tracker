import { describe, expect, it } from 'vitest'
import { alertLink, buildAlertMail, resolveRecipient, type AlertMailItem } from './alert-mail'

const BASE = 'https://app.example'

function item(over: Partial<AlertMailItem> = {}): AlertMailItem {
  return {
    ticker: 'SOL',
    kind: 'einstieg',
    direction: 'below',
    level: 148.2,
    price: 148.05,
    // 2026-08-01T12:32:00Z — der Test gibt die Zeitzone vor, damit er überall
    // dasselbe Ergebnis liefert.
    quotedAtSec: Math.floor(Date.UTC(2026, 7, 1, 12, 32) / 1000),
    tradeId: 42,
    entry: 148.2,
    stop: 141.0,
    target: 165.0,
    ...over,
  }
}

describe('alertLink', () => {
  it('führt bei einem erreichten Einstieg in die Einstiegs-Ansicht', () => {
    expect(alertLink(item(), BASE)).toBe('https://app.example/trades/42/einstieg')
  })

  it('führt bei Stop und Ziel auf den Trade — dort steht keine Einstiegsentscheidung an', () => {
    expect(alertLink(item({ kind: 'stop' }), BASE)).toBe('https://app.example/trades/42')
    expect(alertLink(item({ kind: 'ziel' }), BASE)).toBe('https://app.example/trades/42')
  })

  it('führt ohne Trade ins Cockpit', () => {
    expect(alertLink(item({ kind: 'manuell', tradeId: null }), BASE)).toBe('https://app.example/')
  })

  it('verträgt einen Schrägstrich am Ende der Basis-URL', () => {
    expect(alertLink(item(), 'https://app.example/')).toBe('https://app.example/trades/42/einstieg')
  })
})

describe('buildAlertMail', () => {
  it('gibt null zurück, wenn nichts zu melden ist', () => {
    expect(buildAlertMail({ items: [], baseUrl: BASE })).toBeNull()
  })

  it('nennt im Betreff Wert, Level und Art', () => {
    const mail = buildAlertMail({ items: [item()], baseUrl: BASE, timeZone: 'UTC' })
    expect(mail?.subject).toContain('SOL')
    expect(mail?.subject).toContain('148,20')
  })

  it('fasst mehrere Meldungen in EINER Mail zusammen', () => {
    const mail = buildAlertMail({
      items: [item(), item({ ticker: 'BTC', level: 63533.8, tradeId: 7 })],
      baseUrl: BASE,
      timeZone: 'UTC',
    })
    expect(mail?.subject).toContain('2 Kursmarken')
    expect(mail?.subject).toContain('SOL')
    expect(mail?.subject).toContain('BTC')
    expect(mail?.text).toContain('/trades/42/einstieg')
    expect(mail?.text).toContain('/trades/7/einstieg')
  })

  it('schreibt den Plan mit und weist den Kurs als nicht live aus', () => {
    const mail = buildAlertMail({ items: [item()], baseUrl: BASE, timeZone: 'UTC' })
    expect(mail?.text).toContain('Einstieg 148,20')
    expect(mail?.text).toContain('Stop 141,00')
    expect(mail?.text).toContain('Ziel 165,00')
    expect(mail?.text).toContain('Kurs von 12:32')
    expect(mail?.text).toContain('nicht live')
  })

  it('sagt es, wenn der Kurs gerade nicht abrufbar war', () => {
    const mail = buildAlertMail({
      items: [item({ price: null, quotedAtSec: null })],
      baseUrl: BASE,
      timeZone: 'UTC',
    })
    expect(mail?.text).toContain('gerade nicht abrufbar')
    expect(mail?.text).not.toContain('Kurs von')
  })

  it('zeigt bei sehr kleinen Kursen mehr Nachkommastellen', () => {
    const mail = buildAlertMail({
      items: [item({ ticker: 'SHIB', level: 0.000023, price: 0.000023 })],
      baseUrl: BASE,
      timeZone: 'UTC',
    })
    expect(mail?.text).toContain('0,000023')
  })

  it('fordert nirgends zum Handeln auf', () => {
    const mail = buildAlertMail({ items: [item()], baseUrl: BASE, timeZone: 'UTC' })
    const text = mail!.text.toLowerCase()
    for (const wort of ['kaufen', 'verkaufen', 'jetzt zuschlagen', 'chance']) {
      expect(text).not.toContain(wort)
    }
  })
})

describe('resolveRecipient', () => {
  it('bevorzugt die eigens hinterlegte Adresse', () => {
    expect(resolveRecipient('alarm@example.com', 'konto@example.com')).toBe('alarm@example.com')
  })

  it('fällt auf die Konto-Adresse zurück', () => {
    expect(resolveRecipient(null, 'konto@example.com')).toBe('konto@example.com')
    expect(resolveRecipient('   ', 'konto@example.com')).toBe('konto@example.com')
  })

  it('gibt null zurück, wenn keine Adresse bekannt ist', () => {
    expect(resolveRecipient(null, null)).toBeNull()
    expect(resolveRecipient('', '')).toBeNull()
  })
})
