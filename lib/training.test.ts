import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LEAD_IN,
  LEAD_IN_ALLES,
  LEAD_IN_OPTIONS,
  MAX_START_ANTEIL,
  kontextSchreibbar,
  MIN_HIDDEN_CANDLES,
  MIN_VISIBLE_CANDLES,
  defaultStartIndex,
  startIndexMitVorlauf,
  isBlindMode,
  randomStartIndex,
  requiresElliott,
  sanitizeErrorTags,
  serializeErrorTags,
  parseErrorTags,
  trimText,
  validateThesis,
  type TrainingThesis,
} from './training'

const these = (over: Partial<TrainingThesis> = {}): TrainingThesis => ({
  direction: 'long',
  elliottCount: null,
  invalidation: null,
  entryPrice: null,
  stopLoss: null,
  takeProfit: null,
  note: null,
  setupTags: [],
  ...over,
})

describe('Modi', () => {
  it('verdeckt Zufall und Elliott, nicht die freie Übung', () => {
    expect(isBlindMode('frei')).toBe(false)
    expect(isBlindMode('zufall')).toBe(true)
    expect(isBlindMode('elliott')).toBe(true)
  })

  it('verlangt die Wellenzählung nur im Elliott-Training', () => {
    expect(requiresElliott('elliott')).toBe(true)
    expect(requiresElliott('zufall')).toBe(false)
  })
})

describe('sanitizeErrorTags', () => {
  it('wirft Unbekanntes und Dubletten raus', () => {
    expect(sanitizeErrorTags(['stop_zu_eng', 'stop_zu_eng', 'quatsch'])).toEqual(['stop_zu_eng'])
  })

  it('nimmt "kein Fehler" zurück, sobald ein echter Fehler dabeisteht', () => {
    expect(sanitizeErrorTags(['kein_fehler', 'zu_frueher_einstieg'])).toEqual([
      'zu_frueher_einstieg',
    ])
    expect(sanitizeErrorTags(['kein_fehler'])).toEqual(['kein_fehler'])
  })

  it('begrenzt auf vier Fehler', () => {
    const alle = [
      'falsche_wellenzaehlung',
      'falsche_invalidierung',
      'grad_verwechselt',
      'korrektur_als_impuls',
      'zu_frueher_einstieg',
      'stop_zu_eng',
    ]
    expect(sanitizeErrorTags(alle)).toHaveLength(4)
  })

  it('liefert für zwei gleiche Auswahlen dieselbe Reihenfolge', () => {
    const a = sanitizeErrorTags(['stop_zu_eng', 'falsche_wellenzaehlung'])
    const b = sanitizeErrorTags(['falsche_wellenzaehlung', 'stop_zu_eng'])
    expect(a).toEqual(b)
  })

  it('macht aus leerer Auswahl null statt "[]"', () => {
    expect(serializeErrorTags([])).toBeNull()
    expect(parseErrorTags(null)).toEqual([])
    expect(parseErrorTags('kaputt')).toEqual([])
    expect(parseErrorTags(serializeErrorTags(['stop_zu_eng']))).toEqual(['stop_zu_eng'])
  })
})

describe('randomStartIndex', () => {
  it('lässt immer genug Vergangenheit und genug Zukunft', () => {
    const total = 400
    for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
      const i = randomStartIndex(total, r)
      expect(i).toBeGreaterThanOrEqual(MIN_VISIBLE_CANDLES)
      expect(total - i).toBeGreaterThanOrEqual(MIN_HIDDEN_CANDLES)
    }
  })

  it('nutzt das Fenster von 35 % bis 80 % aus', () => {
    const total = 1000
    expect(randomStartIndex(total, 0)).toBe(350)
    expect(randomStartIndex(total, 0.999999)).toBe(800)
  })

  it('kommt mit knappen Historien und kaputten Zufallszahlen zurecht', () => {
    expect(randomStartIndex(40, Number.NaN)).toBeGreaterThan(0)
    expect(randomStartIndex(40, 0.5)).toBeLessThanOrEqual(40)
  })

  it('setzt den freien Start auf knapp zwei Drittel', () => {
    expect(defaultStartIndex(1000)).toBe(620)
    // Bei kurzer Historie bleibt trotzdem Zukunft übrig.
    expect(1000 - defaultStartIndex(1000)).toBeGreaterThanOrEqual(MIN_HIDDEN_CANDLES)
    expect(defaultStartIndex(50)).toBeLessThanOrEqual(50 - MIN_HIDDEN_CANDLES)
  })
})

describe('validateThesis', () => {
  it('nimmt eine saubere Long-These an', () => {
    expect(
      validateThesis('frei', these({ entryPrice: 100, stopLoss: 95, takeProfit: 115 })),
    ).toEqual([])
  })

  it('lehnt einen Stop über dem Einstieg bei Long ab', () => {
    const f = validateThesis('frei', these({ entryPrice: 100, stopLoss: 105 }))
    expect(f.join(' ')).toContain('Stop unter dem Einstieg')
  })

  it('lehnt ein Ziel unter dem Einstieg bei Short nicht ab', () => {
    expect(
      validateThesis(
        'frei',
        these({ direction: 'short', entryPrice: 100, stopLoss: 105, takeProfit: 90 }),
      ),
    ).toEqual([])
  })

  it('lässt "kein Setup" ohne Level durch', () => {
    expect(validateThesis('frei', these({ direction: 'keine' }))).toEqual([])
  })

  it('verlangt im Elliott-Training Zählung und Invalidation', () => {
    const f = validateThesis('elliott', these({ entryPrice: 100, stopLoss: 95 }))
    expect(f).toHaveLength(2)
    expect(
      validateThesis(
        'elliott',
        these({ entryPrice: 100, stopLoss: 95, elliottCount: 'Welle 3', invalidation: 94 }),
      ),
    ).toEqual([])
  })

  it('weist negative Kurse ab', () => {
    expect(validateThesis('frei', these({ entryPrice: -5 })).join(' ')).toContain('Einstieg')
  })
})

describe('trimText', () => {
  it('macht aus Leerraum null und kürzt zu lange Texte', () => {
    expect(trimText('   ', 10)).toBeNull()
    expect(trimText(42, 10)).toBeNull()
    expect(trimText('  hallo  ', 10)).toBe('hallo')
    expect(trimText('abcdefghijk', 5)).toBe('abcde')
  })
})

describe('startIndexMitVorlauf', () => {
  it('nimmt den gewünschten Vorlauf, wenn er passt', () => {
    expect(startIndexMitVorlauf(1000, 250)).toBe(250)
    expect(startIndexMitVorlauf(1000, 800)).toBe(800)
  })

  it('lässt immer genug Zukunft übrig', () => {
    // 300 Kerzen, Vorlauf 800 gewünscht → 240, also ein Fünftel bleibt verborgen.
    //
    // Bis zur Vorlauf-Stufe „Alles" stand hier `300 - MIN_HIDDEN_CANDLES` = 285.
    // Diese Grenze war die Notbremse und taugte nicht als Maß: Bei 3000 Kerzen
    // ließ sie 15 übrig, die Übung startete optisch durchgelaufen. Maßgeblich
    // ist jetzt `MAX_START_ANTEIL`, dieselbe Grenze, die der Zufallsstart schon
    // immer benutzt hat.
    expect(startIndexMitVorlauf(300, 800)).toBe(240)
    expect(300 - startIndexMitVorlauf(300, 800)).toBeGreaterThan(MIN_HIDDEN_CANDLES)
  })

  it('lässt immer genug Kontext stehen', () => {
    expect(startIndexMitVorlauf(1000, 5)).toBe(MIN_VISIBLE_CANDLES)
  })

  it('kommt mit unsinnigen Eingaben klar', () => {
    expect(startIndexMitVorlauf(1000, Number.NaN)).toBe(DEFAULT_LEAD_IN)
    expect(startIndexMitVorlauf(0, 250)).toBe(0)
  })

  it('bietet nur aufsteigende, sinnvolle Stufen an', () => {
    const werte = LEAD_IN_OPTIONS.map((o) => o.wert)
    expect([...werte].sort((a, b) => a - b)).toEqual(werte)
    expect(werte).toContain(DEFAULT_LEAD_IN)
    expect(werte.every((w) => w >= MIN_VISIBLE_CANDLES)).toBe(true)
  })

  it('bietet „Alles" an, und die Stufe deckelt nicht selbst', () => {
    expect(LEAD_IN_OPTIONS.map((o) => o.wert)).toContain(LEAD_IN_ALLES)
    // Was zählt, ist die Klemmung an die Reihe — nicht der Wunschwert.
    expect(startIndexMitVorlauf(3000, LEAD_IN_ALLES)).toBe(2400)
    // Und er passt in einen Postgres-`integer` (die Spalte `leadIn`).
    expect(LEAD_IN_ALLES).toBeLessThan(2_147_483_647)
  })

  /**
   * Der Fehler, der hier festgenagelt wird: „Alles" ließ bei 3000 Kerzen genau
   * 15 übrig. Die Übung startete optisch durchgelaufen — Balken am rechten
   * Anschlag, nichts mehr aufzudecken. Das sah aus wie ein alter Bug, war aber
   * eine Einstellung, die sich selbst aufhob.
   */
  it('lässt JEDEM Startpunkt mindestens ein Fünftel der Reihe als Zukunft', () => {
    for (const total of [200, 900, 1500, 3000, 8000]) {
      for (const wunsch of [120, 250, 450, 800, LEAD_IN_ALLES]) {
        const start = startIndexMitVorlauf(total, wunsch)
        const verborgen = total - start
        expect(verborgen).toBeGreaterThanOrEqual(
          Math.min(MIN_HIDDEN_CANDLES, Math.ceil(total * (1 - MAX_START_ANTEIL))),
        )
        expect(start).toBeLessThanOrEqual(Math.floor(total * MAX_START_ANTEIL))
      }
    }
  })

  it('lässt kleine Vorläufe unangetastet — die Grenze greift nur nach oben', () => {
    expect(startIndexMitVorlauf(3000, 250)).toBe(250)
    expect(startIndexMitVorlauf(3000, 800)).toBe(800)
    // Erst wo der Wunsch die Übung auflösen würde, gewinnt die Grenze.
    expect(startIndexMitVorlauf(900, 800)).toBe(720)
  })
})

describe('kontextSchreibbar', () => {
  const offen = {
    vorhanden: null,
    status: 'offen',
    revealedAt: null,
    endedAt: null,
    antworten: 0,
  }

  it('lässt schreiben, solange nichts freigegeben ist', () => {
    expect(kontextSchreibbar(offen)).toBe(true)
  })

  it('schreibt nur EINMAL — danach steht er fest', () => {
    expect(kontextSchreibbar({ ...offen, vorhanden: 'Welle 4 einer größeren 3' })).toBe(false)
  })

  it('behandelt leeren Text wie „noch nichts"', () => {
    expect(kontextSchreibbar({ ...offen, vorhanden: '' })).toBe(true)
    expect(kontextSchreibbar({ ...offen, vorhanden: '   ' })).toBe(true)
  })

  it('sperrt, sobald der Durchlauf Kerzen freigegeben hat', () => {
    expect(kontextSchreibbar({ ...offen, antworten: 1 })).toBe(false)
  })

  it('sperrt nach dem Aufdecken, nach dem Ende und außerhalb von „offen"', () => {
    expect(kontextSchreibbar({ ...offen, revealedAt: new Date() })).toBe(false)
    expect(kontextSchreibbar({ ...offen, endedAt: new Date() })).toBe(false)
    expect(kontextSchreibbar({ ...offen, status: 'festgeschrieben' })).toBe(false)
    expect(kontextSchreibbar({ ...offen, status: 'bewertet' })).toBe(false)
    expect(kontextSchreibbar({ ...offen, status: 'abgebrochen' })).toBe(false)
  })
})
