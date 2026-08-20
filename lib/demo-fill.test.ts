import { describe, expect, it } from 'vitest'
import { demoFills, offeneMenge, type DemoFillTrade } from './demo-fill'
import type { EffectiveTarget } from './trade-targets'
import type { Candle } from './market-data/types'

// Ein Long: Einstieg 100, Stop 95, Ziele bei 110 und 120.
const LONG: DemoFillTrade = {
  status: 'geplant',
  direction: 'long',
  entryPrice: 100,
  stopLoss: 95,
  positionSize: 100,
}

function stufe(p: Partial<EffectiveTarget> & { price: number }): EffectiveTarget {
  return {
    id: p.id ?? 1,
    sortOrder: p.sortOrder ?? 0,
    price: p.price,
    sharePct: p.sharePct ?? 50,
    executedAt: p.executedAt ?? null,
    executedPrice: p.executedPrice ?? null,
    executedQty: p.executedQty ?? null,
    note: p.note ?? null,
  }
}

const ZIELE: EffectiveTarget[] = [
  stufe({ id: 1, sortOrder: 0, price: 110, sharePct: 40 }),
  stufe({ id: 2, sortOrder: 1, price: 120, sharePct: 60 }),
]

function kerze(p: Partial<Candle>): Candle {
  return {
    time: p.time ?? 1_700_000_000,
    open: p.open ?? 100,
    high: p.high ?? 100,
    low: p.low ?? 100,
    close: p.close ?? 100,
    volume: p.volume ?? 0,
  }
}

describe('Einstieg', () => {
  it('füllt, sobald die Kerze den Einstieg berührt', () => {
    const f = demoFills({
      trade: LONG,
      targets: ZIELE,
      candle: kerze({ open: 103, high: 104, low: 99, close: 102 }),
    })
    expect(f).toHaveLength(1)
    expect(f[0].art).toBe('einstieg')
    expect(f[0].preis).toBe(100)
    expect(f[0].menge).toBe(100)
    expect(f[0].schliesst).toBe(false)
  })

  it('löst nicht aus, wenn die Kerze den Einstieg nicht erreicht', () => {
    const f = demoFills({
      trade: LONG,
      targets: ZIELE,
      candle: kerze({ open: 105, high: 107, low: 103, close: 106 }),
    })
    expect(f).toEqual([])
  })

  it('führt bei einer Lücke zur ERÖFFNUNG aus, nicht zum Wunschlevel', () => {
    // Long-Limit bei 100, zuletzt stand der Kurs bei 103 — der Einstieg wird
    // also von OBEN angelaufen. Die Kerze eröffnet mit einer Abwärtslücke bei
    // 96: Das Level 100 gab es an diesem Tag nie, der erste handelbare Kurs
    // ist 96. Real wäre die Limit-Order gefüllt worden, sogar besser.
    const f = demoFills({
      trade: LONG,
      targets: ZIELE,
      candle: kerze({ open: 96, high: 99, low: 96, close: 98 }),
      vorherKurs: 103,
    })
    expect(f).toHaveLength(1)
    expect(f[0].art).toBe('einstieg')
    expect(f[0].preis).toBe(96)
    expect(f[0].grund).toContain('Eröffnung')
  })

  it('füllt einen Ausbruchskauf NICHT, wenn die Kerze unter dem Einstieg bleibt', () => {
    // Derselbe Long, aber der Kurs stand zuletzt bei 97 — der Einstieg bei 100
    // ist eine Stop-Order über dem Kurs. Eine Kerze von 94 bis 99 hat ihn nie
    // erreicht. Ohne die Anlaufseite sähe dieser Fall genauso aus wie der
    // Lücken-Fill darüber.
    const f = demoFills({
      trade: LONG,
      targets: ZIELE,
      candle: kerze({ open: 96, high: 99, low: 94, close: 98 }),
      vorherKurs: 97,
    })
    expect(f).toEqual([])
  })

  it('bleibt ohne Vorkurs bei der echten Berührung — kein erfundener Einstieg', () => {
    const f = demoFills({
      trade: LONG,
      targets: ZIELE,
      candle: kerze({ open: 96, high: 99, low: 96, close: 98 }),
    })
    expect(f).toEqual([])
  })

  it('übernimmt die Kerzenzeit, nicht die Uhrzeit des Laufs', () => {
    const f = demoFills({
      trade: LONG,
      targets: ZIELE,
      candle: kerze({ time: 1_234_567_890, open: 101, high: 102, low: 99, close: 100 }),
    })
    expect(f[0].zeit).toBe(1_234_567_890)
  })
})

describe('Stop schlägt Ziel', () => {
  it('bucht den Stop, wenn eine Kerze Stop UND Ziel berührt', () => {
    const aktiv = { ...LONG, status: 'aktiv' }
    const f = demoFills({
      trade: aktiv,
      targets: ZIELE,
      candle: kerze({ open: 100, high: 125, low: 94, close: 100 }),
    })
    expect(f).toHaveLength(1)
    expect(f[0].art).toBe('stop')
    expect(f[0].preis).toBe(95)
    expect(f[0].schliesst).toBe(true)
  })

  it('stoppt einen Trade aus, der in derselben Kerze eröffnet wurde', () => {
    const f = demoFills({
      trade: LONG,
      targets: ZIELE,
      candle: kerze({ open: 101, high: 102, low: 94, close: 96 }),
    })
    expect(f.map((x) => x.art)).toEqual(['einstieg', 'stop'])
    expect(f[1].schliesst).toBe(true)
  })

  it('schließt bei short über die Gegenrichtung', () => {
    const short: DemoFillTrade = {
      status: 'aktiv',
      direction: 'short',
      entryPrice: 100,
      stopLoss: 105,
      positionSize: 50,
    }
    const f = demoFills({
      trade: short,
      targets: [stufe({ id: 1, sortOrder: 0, price: 90, sharePct: 100 })],
      candle: kerze({ open: 100, high: 106, low: 99, close: 104 }),
    })
    expect(f).toHaveLength(1)
    expect(f[0].art).toBe('stop')
    expect(f[0].preis).toBe(105)
  })
})

describe('Zielstufen', () => {
  it('nimmt das Teilziel, ohne den Trade zu schließen', () => {
    const aktiv = { ...LONG, status: 'aktiv' }
    const f = demoFills({
      trade: aktiv,
      targets: ZIELE,
      candle: kerze({ open: 105, high: 112, low: 104, close: 111 }),
    })
    expect(f).toHaveLength(1)
    expect(f[0].art).toBe('teilziel')
    expect(f[0].menge).toBe(40) // 40 % von 100
    expect(f[0].schliesst).toBe(false)
  })

  it('nimmt Teilziel und Ziel in derselben Kerze, Rest an der letzten Stufe', () => {
    const aktiv = { ...LONG, status: 'aktiv' }
    const f = demoFills({
      trade: aktiv,
      targets: ZIELE,
      candle: kerze({ open: 105, high: 122, low: 104, close: 121 }),
    })
    expect(f.map((x) => x.art)).toEqual(['teilziel', 'ziel'])
    expect(f[0].menge).toBe(40)
    expect(f[1].menge).toBe(60) // der Rest, nicht erneut 60 %
    expect(f[1].schliesst).toBe(true)
  })

  it('überspringt eine bereits ausgeführte Stufe und rechnet den Rest richtig', () => {
    const aktiv = { ...LONG, status: 'aktiv' }
    const targets: EffectiveTarget[] = [
      stufe({
        id: 1,
        sortOrder: 0,
        price: 110,
        sharePct: 40,
        executedAt: new Date('2026-08-01'),
        executedQty: 40,
      }),
      stufe({ id: 2, sortOrder: 1, price: 120, sharePct: 60 }),
    ]
    const f = demoFills({
      trade: aktiv,
      targets,
      candle: kerze({ open: 118, high: 121, low: 117, close: 120 }),
    })
    expect(f).toHaveLength(1)
    expect(f[0].art).toBe('ziel')
    expect(f[0].menge).toBe(60) // 100 Anfang − 40 bereits verkauft
  })

  it('gibt der letzten Stufe den nicht verteilten Rest', () => {
    // Anteile summieren auf 70 % — die restlichen 30 % laufen bis zur letzten Stufe.
    const aktiv = { ...LONG, status: 'aktiv' }
    const targets: EffectiveTarget[] = [
      stufe({ id: 1, sortOrder: 0, price: 110, sharePct: 30 }),
      stufe({ id: 2, sortOrder: 1, price: 120, sharePct: 40 }),
    ]
    const f = demoFills({
      trade: aktiv,
      targets,
      candle: kerze({ open: 105, high: 125, low: 104, close: 124 }),
    })
    expect(f[0].menge).toBe(30)
    expect(f[1].menge).toBe(70) // 100 − 30, nicht 40
    expect(f[0].menge + f[1].menge).toBe(100)
  })

  it('führt ein übersprungenes Ziel zur Eröffnung aus', () => {
    const aktiv = { ...LONG, status: 'aktiv' }
    const f = demoFills({
      trade: aktiv,
      targets: [stufe({ id: 1, sortOrder: 0, price: 110, sharePct: 100 })],
      candle: kerze({ open: 115, high: 118, low: 114, close: 117 }),
    })
    expect(f[0].preis).toBe(115)
    expect(f[0].grund).toContain('Kursziel')
  })

  it('kommt ohne trade_target aus (einzige Stufe aus takeProfit, id null)', () => {
    const aktiv = { ...LONG, status: 'aktiv' }
    const f = demoFills({
      trade: aktiv,
      targets: [stufe({ id: null as unknown as number, sortOrder: 0, price: 110, sharePct: 100 })],
      candle: kerze({ open: 105, high: 111, low: 104, close: 110 }),
    })
    expect(f).toHaveLength(1)
    expect(f[0].art).toBe('ziel')
    expect(f[0].schliesst).toBe(true)
    expect(f[0].menge).toBe(100)
  })
})

describe('Trade nimmt keine Ausführung mehr an', () => {
  it('rührt einen abgeschlossenen Trade nicht an', () => {
    const zu = { ...LONG, status: 'abgeschlossen' }
    const f = demoFills({
      trade: zu,
      targets: ZIELE,
      candle: kerze({ open: 100, high: 125, low: 90, close: 120 }),
    })
    expect(f).toEqual([])
  })

  it('rührt einen abgebrochenen Trade nicht an', () => {
    const weg = { ...LONG, status: 'abgebrochen' }
    const f = demoFills({
      trade: weg,
      targets: ZIELE,
      candle: kerze({ open: 100, high: 125, low: 90, close: 120 }),
    })
    expect(f).toEqual([])
  })

  it('ignoriert eine Kerze ohne verwertbares High/Low', () => {
    const aktiv = { ...LONG, status: 'aktiv' }
    const f = demoFills({
      trade: aktiv,
      targets: ZIELE,
      candle: kerze({ open: 100, high: NaN, low: NaN, close: 100 }),
    })
    expect(f).toEqual([])
  })
})

describe('Vor dem Prüffenster erreicht', () => {
  it('markiert ein Ziel, das schon vorher überschritten war', () => {
    // Der Long-Trade will bei 110 aussteigen, das Papier steht aber längst bei
    // 305. Ohne diese Markierung würde der Trade zum heutigen Kurs abgerechnet
    // — ein Gewinn, den es nie gab.
    const aktiv = { ...LONG, status: 'aktiv' }
    const f = demoFills({
      trade: aktiv,
      targets: [stufe({ id: 1, sortOrder: 0, price: 110, sharePct: 100 })],
      candle: kerze({ open: 307, high: 309, low: 305, close: 308 }),
      vorherKurs: 305,
    })
    expect(f).toHaveLength(1)
    expect(f[0].vorFenster).toBe(true)
  })

  it('markiert einen Stop, der schon vorher unterschritten war', () => {
    const aktiv = { ...LONG, status: 'aktiv' }
    const f = demoFills({
      trade: aktiv,
      targets: ZIELE,
      candle: kerze({ open: 80, high: 82, low: 78, close: 81 }),
      vorherKurs: 80,
    })
    expect(f[0].art).toBe('stop')
    expect(f[0].vorFenster).toBe(true)
  })

  it('markiert einen echten Treffer im Fenster NICHT', () => {
    const aktiv = { ...LONG, status: 'aktiv' }
    const f = demoFills({
      trade: aktiv,
      targets: ZIELE,
      candle: kerze({ open: 105, high: 112, low: 104, close: 111 }),
      vorherKurs: 105,
    })
    expect(f[0].art).toBe('teilziel')
    expect(f[0].vorFenster).toBe(false)
  })

  it('markiert nichts, wenn kein Vorkurs bekannt ist', () => {
    const aktiv = { ...LONG, status: 'aktiv' }
    const f = demoFills({
      trade: aktiv,
      targets: ZIELE,
      candle: kerze({ open: 105, high: 112, low: 104, close: 111 }),
    })
    expect(f[0].vorFenster).toBe(false)
  })
})

describe('offeneMenge', () => {
  it('zieht ausgeführte Mengen ab, nicht geplante Anteile', () => {
    const targets: EffectiveTarget[] = [
      stufe({ id: 1, price: 110, sharePct: 40, executedAt: new Date('2026-08-01'), executedQty: 35 }),
      stufe({ id: 2, price: 120, sharePct: 60 }),
    ]
    // 35 tatsächlich verkauft, nicht die geplanten 40.
    expect(offeneMenge(100, targets)).toBe(65)
  })

  it('meldet 0 statt einer geratenen Zahl, wenn keine Position bekannt ist', () => {
    expect(offeneMenge(0, ZIELE)).toBe(0)
    expect(offeneMenge(NaN, ZIELE)).toBe(0)
  })

  it('fällt nie unter null', () => {
    const targets = [stufe({ id: 1, price: 110, executedAt: new Date(), executedQty: 150 })]
    expect(offeneMenge(100, targets)).toBe(0)
  })
})
