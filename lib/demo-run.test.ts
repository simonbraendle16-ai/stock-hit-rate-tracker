// Geprüft wird hier die EGRESS-GRENZE des Demo-Laufs — die Regel, ohne die er
// bei jedem Durchgang dieselbe, stetig wachsende Kerzenmenge erneut liest.
// Der Rest von `demo-run.ts` schreibt in die Datenbank und gehört nicht in die
// Suite; die Ausführungsentscheidung selbst steht in `demo-fill.test.ts`.
import { describe, expect, it } from 'vitest'
import { pruefBeginn, PRUEF_FENSTER_MS } from './demo-run'
import type { trade } from './db/schema'

type TradeRow = typeof trade.$inferSelect

const JETZT = new Date('2026-08-20T12:00:00Z').getTime()

function tradeMit(p: { openedAt?: Date | null; createdAt: Date }): TradeRow {
  return {
    openedAt: p.openedAt ?? null,
    createdAt: p.createdAt,
  } as unknown as TradeRow
}

function ereignis(at: Date) {
  return { at } as unknown as Parameters<typeof pruefBeginn>[1][number]
}

describe('pruefBeginn', () => {
  it('nimmt das letzte Ereignis, wenn es im Fenster liegt', () => {
    const vorEinerStunde = new Date(JETZT - 60 * 60 * 1000)
    const r = pruefBeginn(
      tradeMit({ createdAt: new Date('2026-01-01') }),
      [ereignis(vorEinerStunde)],
      JETZT,
    )
    expect(r.beginn.getTime()).toBe(vorEinerStunde.getTime())
    expect(r.gekappt).toBe(false)
  })

  it('KAPPT ein Ereignis, das älter ist als das Fenster', () => {
    // Der eigentliche Egress-Schutz: Ein Trade, an dem seit Wochen nichts
    // passiert ist, darf nicht bei jedem Lauf Wochen an Kerzen nachlesen.
    const vorDreiWochen = new Date(JETZT - 21 * 24 * 60 * 60 * 1000)
    const r = pruefBeginn(
      tradeMit({ createdAt: new Date('2026-01-01') }),
      [ereignis(vorDreiWochen)],
      JETZT,
    )
    expect(r.beginn.getTime()).toBe(JETZT - PRUEF_FENSTER_MS)
    expect(r.gekappt).toBe(true)
  })

  it('fällt ohne Ereignis auf die Eröffnung zurück', () => {
    const vorZehnMinuten = new Date(JETZT - 10 * 60 * 1000)
    const r = pruefBeginn(tradeMit({ openedAt: vorZehnMinuten, createdAt: new Date('2026-01-01') }), [], JETZT)
    expect(r.beginn.getTime()).toBe(vorZehnMinuten.getTime())
    expect(r.gekappt).toBe(false)
  })

  it('fällt ohne Eröffnung auf die Anlage zurück — und kappt sie, wenn sie alt ist', () => {
    const r = pruefBeginn(tradeMit({ createdAt: new Date('2026-01-01') }), [], JETZT)
    expect(r.beginn.getTime()).toBe(JETZT - PRUEF_FENSTER_MS)
    expect(r.gekappt).toBe(true)
  })

  it('nimmt das JÜNGSTE Ereignis, nicht das erste', () => {
    const alt = new Date(JETZT - 90 * 60 * 1000)
    const neu = new Date(JETZT - 30 * 60 * 1000)
    const r = pruefBeginn(
      tradeMit({ createdAt: new Date('2026-01-01') }),
      [ereignis(alt), ereignis(neu)],
      JETZT,
    )
    expect(r.beginn.getTime()).toBe(neu.getTime())
  })

  it('das Fenster ist zwei Stunden — ein voller Lauf Puffer beim stündlichen Takt', () => {
    expect(PRUEF_FENSTER_MS).toBe(2 * 60 * 60 * 1000)
  })
})
