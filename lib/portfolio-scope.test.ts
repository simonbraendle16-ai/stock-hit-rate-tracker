import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCOPE,
  MAX_PORTFOLIO_NAME,
  PORTFOLIO_KINDS,
  checkArchivable,
  checkDeletable,
  checkKindChange,
  checkMove,
  checkPortfolioName,
  formatScope,
  isBookable,
  isPaperScope,
  moveEffect,
  normalizePortfolioKind,
  parseScope,
  resolveScope,
  scopePortfolioIds,
  type PortfolioLike,
  type Scope,
} from './portfolio-scope'

/** Ein Konto mit zwei Echtgeld-Depots, einem Demo und einem archivierten. */
const echt: PortfolioLike = { id: 1, kind: 'echtgeld', archivedAt: null }
const echt2: PortfolioLike = { id: 2, kind: 'echtgeld', archivedAt: null }
const demo: PortfolioLike = { id: 3, kind: 'demo', archivedAt: null }
const alt: PortfolioLike = { id: 4, kind: 'echtgeld', archivedAt: new Date('2026-01-01') }
const alle = [echt, echt2, demo, alt]

describe('normalizePortfolioKind', () => {
  it('lässt gültige Arten durch', () => {
    for (const k of PORTFOLIO_KINDS) expect(normalizePortfolioKind(k)).toBe(k)
  })

  it('fällt bei Unbekanntem auf Echtgeld zurück', () => {
    // Bewusst NICHT auf 'demo': Unbekanntes darf nie dazu führen, dass ein
    // echter Trade als Übung durchgeht und aus der Bilanz verschwindet.
    for (const v of [null, undefined, '', 'papier', 'ECHTGELD', 'paper']) {
      expect(normalizePortfolioKind(v)).toBe('echtgeld')
    }
  })
})

describe('parseScope / formatScope', () => {
  it('liest das Aggregat und ein einzelnes Depot', () => {
    expect(parseScope('echtgeld')).toEqual({ type: 'alleEchtgeld' })
    expect(parseScope('depot:7')).toEqual({ type: 'depot', portfolioId: 7 })
    expect(parseScope('  depot:7  ')).toEqual({ type: 'depot', portfolioId: 7 })
  })

  it('fällt bei allem Unklaren auf das Echtgeld-Aggregat zurück, nie auf Demo', () => {
    for (const v of [
      null,
      undefined,
      '',
      'demo',
      'depot:',
      'depot:0',
      'depot:-3',
      'depot:abc',
      'depot:1.5',
      'alles',
    ]) {
      expect(parseScope(v)).toEqual(DEFAULT_SCOPE)
    }
    expect(DEFAULT_SCOPE).toEqual({ type: 'alleEchtgeld' })
  })

  it('ist umkehrbar', () => {
    const faelle: Scope[] = [{ type: 'alleEchtgeld' }, { type: 'depot', portfolioId: 42 }]
    for (const s of faelle) expect(parseScope(formatScope(s))).toEqual(s)
  })
})

describe('scopePortfolioIds', () => {
  it('nimmt im Aggregat nur aktive Echtgeld-Depots — Demo und Archiv bleiben draußen', () => {
    expect(scopePortfolioIds({ type: 'alleEchtgeld' }, alle)).toEqual([1, 2])
  })

  it('nimmt bei einem einzelnen Depot genau dieses, auch ein archiviertes', () => {
    expect(scopePortfolioIds({ type: 'depot', portfolioId: 3 }, alle)).toEqual([3])
    expect(scopePortfolioIds({ type: 'depot', portfolioId: 4 }, alle)).toEqual([4])
  })

  it('liefert für ein fremdes Depot NICHTS statt alles', () => {
    // Der entscheidende Fall: Ein verwaister oder fremder Verweis darf keine
    // Zahlen einblenden, die nicht zur Auswahl gehören.
    expect(scopePortfolioIds({ type: 'depot', portfolioId: 999 }, alle)).toEqual([])
  })

  it('liefert im leeren Konto ein leeres Aggregat', () => {
    expect(scopePortfolioIds({ type: 'alleEchtgeld' }, [])).toEqual([])
  })
})

describe('isPaperScope', () => {
  it('ist nur bei einem einzelnen Demo-Depot wahr', () => {
    expect(isPaperScope({ type: 'depot', portfolioId: 3 }, alle)).toBe(true)
    expect(isPaperScope({ type: 'depot', portfolioId: 1 }, alle)).toBe(false)
  })

  it('ist beim Aggregat niemals wahr — es enthält keine Demo-Depots', () => {
    expect(isPaperScope({ type: 'alleEchtgeld' }, alle)).toBe(false)
  })

  it('ist bei unbekanntem Depot nicht wahr', () => {
    expect(isPaperScope({ type: 'depot', portfolioId: 999 }, alle)).toBe(false)
  })
})

describe('resolveScope', () => {
  it('heilt einen Verweis auf ein Depot, das es nicht mehr gibt', () => {
    const r = resolveScope('depot:999', alle)
    expect(r.scope).toEqual(DEFAULT_SCOPE)
    expect(r.changed).toBe(true)
  })

  it('lässt eine gültige Auswahl unverändert', () => {
    const r = resolveScope('depot:3', alle)
    expect(r.scope).toEqual({ type: 'depot', portfolioId: 3 })
    expect(r.changed).toBe(false)
  })

  it('meldet einen zu bereinigenden Speicherwert', () => {
    // 'kaputt' wird zum Aggregat — und soll zurückgeschrieben werden.
    const r = resolveScope('kaputt', alle)
    expect(r.scope).toEqual(DEFAULT_SCOPE)
    expect(r.changed).toBe(true)
  })

  it('behält ein archiviertes Depot als Auswahl (Historie bleibt lesbar)', () => {
    const r = resolveScope('depot:4', alle)
    expect(r.scope).toEqual({ type: 'depot', portfolioId: 4 })
  })
})

describe('isBookable', () => {
  it('erlaubt Buchen nur in ein einzelnes Depot', () => {
    expect(isBookable({ type: 'depot', portfolioId: 1 })).toBe(true)
    expect(isBookable({ type: 'alleEchtgeld' })).toBe(false)
  })
})

describe('checkPortfolioName', () => {
  const bestand = [
    { id: 1, name: 'Hauptdepot', archivedAt: null },
    { id: 2, name: 'Demo', archivedAt: null },
    { id: 3, name: 'Comdirect', archivedAt: new Date('2026-01-01') },
  ]

  it('verlangt einen Namen', () => {
    expect(checkPortfolioName('   ', bestand).ok).toBe(false)
  })

  it('begrenzt die Länge', () => {
    expect(checkPortfolioName('x'.repeat(MAX_PORTFOLIO_NAME), bestand).ok).toBe(true)
    expect(checkPortfolioName('x'.repeat(MAX_PORTFOLIO_NAME + 1), bestand).ok).toBe(false)
  })

  it('weist Doppelnamen unabhängig von Groß-/Kleinschreibung ab', () => {
    expect(checkPortfolioName('hauptdepot', bestand).ok).toBe(false)
    expect(checkPortfolioName('  HAUPTDEPOT ', bestand).ok).toBe(false)
  })

  it('erlaubt den eigenen Namen beim Umbenennen', () => {
    expect(checkPortfolioName('Hauptdepot', bestand, 1).ok).toBe(true)
  })

  it('lässt den Namen eines archivierten Depots wieder zu', () => {
    expect(checkPortfolioName('Comdirect', bestand).ok).toBe(true)
  })
})

describe('checkKindChange', () => {
  it('erlaubt die Änderung nur im leeren Depot', () => {
    expect(checkKindChange(0).ok).toBe(true)
    expect(checkKindChange(1).ok).toBe(false)
  })
})

describe('checkDeletable', () => {
  it('löscht nur leere Depots', () => {
    expect(checkDeletable(0, 0).ok).toBe(true)
    expect(checkDeletable(1, 0).ok).toBe(false)
    expect(checkDeletable(0, 1).ok).toBe(false)
  })
})

describe('checkArchivable', () => {
  it('archiviert ein Echtgeld-Depot, solange ein weiteres aktiv bleibt', () => {
    expect(checkArchivable(echt, alle).ok).toBe(true)
  })

  it('schützt das letzte aktive Echtgeld-Depot', () => {
    // Ohne es gäbe es keine Bilanz und keinen Ort für einen echten Trade.
    expect(checkArchivable(echt, [echt, demo]).ok).toBe(false)
  })

  it('archiviert ein Demo-Depot auch als einziges', () => {
    expect(checkArchivable(demo, [echt, demo]).ok).toBe(true)
  })

  it('archiviert nichts zweimal', () => {
    expect(checkArchivable(alt, alle).ok).toBe(false)
  })
})

describe('moveEffect', () => {
  it('macht aus einem Demo-Trade beim Wechsel ins Echtgeld-Depot einen echten', () => {
    expect(moveEffect('demo', 'echtgeld')).toEqual({
      tradedWithMoney: true,
      crossesKind: true,
      feesCount: true,
    })
  })

  it('lässt die Gebühren bei Echtgeld → Demo nicht mehr zählen', () => {
    // Auf Papier fällt keine Gebühr an — dieselbe Regel wie in `tradeFees`.
    expect(moveEffect('echtgeld', 'demo')).toEqual({
      tradedWithMoney: false,
      crossesKind: true,
      feesCount: false,
    })
  })

  it('lässt die Handelsart beim Umbuchen innerhalb derselben Art in Ruhe', () => {
    expect(moveEffect('echtgeld', 'echtgeld')).toEqual({
      tradedWithMoney: true,
      crossesKind: false,
      feesCount: true,
    })
    expect(moveEffect('demo', 'demo')).toEqual({
      tradedWithMoney: false,
      crossesKind: false,
      feesCount: false,
    })
  })

  it('ist verlustfrei umkehrbar — zweimal umbuchen führt zum Ausgangszustand', () => {
    // Der Grund, warum die Gebühren NICHT genullt werden: Sonst wäre die
    // tatsächlich gezahlte Gebühr nach einem Hin und Her für immer verloren.
    const hin = moveEffect('echtgeld', 'demo')
    const zurueck = moveEffect('demo', 'echtgeld')
    expect(hin.tradedWithMoney).toBe(false)
    expect(zurueck.tradedWithMoney).toBe(true)
    expect(zurueck.feesCount).toBe(true)
  })
})

describe('checkMove', () => {
  it('bucht nicht in ein unbekanntes Depot', () => {
    expect(checkMove(undefined, 1).ok).toBe(false)
  })

  it('bucht nicht dorthin, wo der Trade schon liegt', () => {
    expect(checkMove(echt, 1).ok).toBe(false)
  })

  it('bucht nicht in ein archiviertes Depot', () => {
    expect(checkMove(alt, 1).ok).toBe(false)
  })

  it('erlaubt den gewöhnlichen Wechsel', () => {
    expect(checkMove(demo, 1).ok).toBe(true)
  })
})
