// Tests der reinen Auflösungslogik — alles ohne Netzzugriff.
//
// Die Fälle sind KEINE erfundenen Beispiele: Jeder einzelne stammt aus dem
// echten Bestand der Watchlist und hat vorher zu einem falschen oder fehlenden
// Kurs geführt. Sie stehen hier, damit genau diese Fehler nicht zurückkommen.

import { describe, expect, it } from 'vitest'
import {
  editDistance,
  foldDiacritics,
  instrumentClass,
  isConfident,
  nameSimilarity,
  nameTokens,
  scoreEvidence,
  tokensMatch,
  venueRank,
} from './resolve'

describe('foldDiacritics', () => {
  it('faltet deutsche Umlaute so aus, wie die Suche sie erwartet', () => {
    // Ohne diese Faltung findet die Symbolsuche „SÜSS Microtec" nicht.
    // Groß-Ü wird zu „Ue" — die Suche ist ohnehin nicht auf Groß- und
    // Kleinschreibung angewiesen, entscheidend ist der Wegfall des Umlauts.
    expect(foldDiacritics('SÜSS Microtec')).toBe('SUeSS Microtec')
    expect(foldDiacritics('Hannover Rück')).toBe('Hannover Rueck')
    expect(foldDiacritics('Größe')).toBe('Groesse')
  })

  it('entfernt kombinierende Akzente', () => {
    expect(foldDiacritics('Moët')).toBe('Moet')
    expect(foldDiacritics('Société')).toBe('Societe')
  })
})

describe('nameTokens', () => {
  it('wirft Rechtsformen weg, die keinen Wert unterscheiden', () => {
    expect(nameTokens('SAP SE')).toEqual(['sap'])
    expect(nameTokens('Fiserv, Inc.')).toEqual(['fiserv'])
    expect(nameTokens('Alibaba Group Holding Limited')).toEqual(['alibaba'])
  })

  it('behält unterscheidende Bestandteile', () => {
    expect(nameTokens('Deutsche Bank AG')).toEqual(['deutsche', 'bank'])
    expect(nameTokens('Deutsche Telekom AG')).toEqual(['deutsche', 'telekom'])
  })
})

describe('editDistance', () => {
  it('zählt einzelne Vertauschungen und Einfügungen', () => {
    // „etherium" ↔ „ethereum": ein vertauschter Buchstabe.
    expect(editDistance('etherium', 'ethereum', 2)).toBe(1)
    // „cruide" ↔ „crude": ein eingefügter Buchstabe.
    expect(editDistance('cruide', 'crude', 2)).toBe(1)
    expect(editDistance('gleich', 'gleich', 2)).toBe(0)
  })

  it('bricht oberhalb der Schranke ab, statt weiterzurechnen', () => {
    expect(editDistance('barrick', 'völlig anders', 2)).toBeGreaterThan(2)
  })
})

describe('tokensMatch', () => {
  it('verzeiht Tippfehler in längeren Wörtern', () => {
    // Beide stehen so im echten Bestand.
    expect(tokensMatch('etherium', 'ethereum')).toBe(true)
    expect(tokensMatch('cruide', 'crude')).toBe(true)
  })

  it('lässt kurze Präfixe NICHT durchgehen', () => {
    // Sonst verdrängt die südafrikanische Sappi Ltd. die SAP SE.
    expect(tokensMatch('sap', 'sappi')).toBe(false)
  })

  it('akzeptiert Präfixe, die den längeren Namen wirklich tragen', () => {
    expect(tokensMatch('alphabet', 'alphabets')).toBe(true)
    expect(tokensMatch('microtec', 'microtech')).toBe(true)
  })

  it('hält ähnlich lange, aber verschiedene Wörter auseinander', () => {
    expect(tokensMatch('barrick', 'warwick')).toBe(false)
  })
})

describe('nameSimilarity', () => {
  it('erkennt denselben Wert trotz abweichender Schreibweise', () => {
    expect(nameSimilarity('Hannover Rueck SE', 'HANNOVER RUECK SE NA O.N.')).toBe(1)
    expect(nameSimilarity('Adidas', 'adidas AG')).toBe(1)
  })

  it('bewertet einen knappen Anbieternamen nicht künstlich schlecht', () => {
    // „DAX P" ist vollständig in „Dax 40 Index" enthalten.
    expect(nameSimilarity('Dax 40 Index', 'DAX P')).toBeGreaterThan(0.6)
  })

  it('trennt verschiedene Werte', () => {
    expect(nameSimilarity('Deutsche Bank', 'Deutsche Telekom')).toBeLessThan(0.6)
    expect(nameSimilarity('Apple', 'Alphabet')).toBe(0)
  })
})

describe('instrumentClass', () => {
  it('fasst Aktie und Fonds zusammen', () => {
    // Yahoo führt Hinterlegungsscheine als ETF — dieselbe Firma wie die Aktie.
    expect(instrumentClass('EQUITY')).toBe(instrumentClass('ETF'))
  })

  it('trennt, was wirklich verschieden ist', () => {
    expect(instrumentClass('CRYPTOCURRENCY')).not.toBe(instrumentClass('EQUITY'))
    expect(instrumentClass('INDEX')).not.toBe(instrumentClass('ETF'))
    expect(instrumentClass('FUTURE')).not.toBe(instrumentClass('EQUITY'))
  })

  it('kommt ohne Angabe zurecht', () => {
    expect(instrumentClass(null)).toBeNull()
  })
})

describe('venueRank', () => {
  it('stellt Heimatbörsen vor deutsche Regionalbörsen', () => {
    expect(venueRank('ADS.DE')).toBeLessThan(venueRank('ADS.MU'))
    expect(venueRank('ADS.DE')).toBeLessThan(venueRank('ADS.SG'))
    expect(venueRank('AIR.PA')).toBeLessThan(venueRank('AIR.F'))
  })

  it('kennt US-Notierungen ohne Suffix', () => {
    expect(venueRank('AAPL')).toBe(0)
  })
})

const evidence = (over: Partial<Parameters<typeof isConfident>[0]> = {}) => ({
  aliasDerived: false,
  baseMatch: false,
  exactSymbol: false,
  nameSim: 0,
  typeMatch: null,
  ...over,
})

describe('isConfident', () => {
  it('vertraut deterministischen Übersetzungen', () => {
    // `CL1!` → `CL=F`: Der Anbietername („Crude Oil Sep 26") stimmt mit dem
    // eingetippten („Light Cruide Oil Futures") kaum überein, trotzdem ist die
    // Zuordnung eindeutig.
    expect(isConfident(evidence({ aliasDerived: true }))).toBe(true)
  })

  it('vertraut einem wörtlich existierenden Kürzel', () => {
    // „AMD" heißt beim Anbieter „Advanced Micro Devices" — kein Namenstreffer,
    // aber das Kürzel ist exakt das eingetippte.
    expect(isConfident(evidence({ exactSymbol: true, baseMatch: true }))).toBe(true)
  })

  it('verlangt bei bloßer Tickerwurzel zusätzlich den Namen', () => {
    expect(isConfident(evidence({ baseMatch: true, nameSim: 0 }))).toBe(false)
    expect(isConfident(evidence({ baseMatch: true, nameSim: 0.5 }))).toBe(true)
  })

  it('lässt einen starken Namenstreffer ohne Tickerbezug gelten', () => {
    // Rettet den Fall, in dem der eingetippte Ticker schlicht falsch ist.
    expect(isConfident(evidence({ nameSim: 0.8 }))).toBe(true)
    expect(isConfident(evidence({ nameSim: 0.5 }))).toBe(false)
  })

  it('lehnt ab, wenn gar nichts trägt', () => {
    expect(isConfident(evidence())).toBe(false)
  })
})

describe('scoreEvidence', () => {
  it('bewertet Tickerwurzel plus Name über einem knappen Kürzeltreffer', () => {
    const voll = scoreEvidence(evidence({ baseMatch: true, nameSim: 1 }), 0)
    const knapp = scoreEvidence(evidence({ baseMatch: true, nameSim: 0 }), 0)
    expect(voll).toBeGreaterThan(knapp)
  })

  it('hebt ein wörtlich passendes Kürzel deutlich genug ab', () => {
    // „AMD" (Advanced Micro Devices) gegen „AMD.AX" (Arrow Minerals): Beide
    // teilen die Tickerwurzel, nur eines ist wörtlich das Eingetippte. Der
    // Abstand muss über der Mehrdeutigkeitsschwelle von 12 liegen.
    const echt = scoreEvidence(evidence({ baseMatch: true, exactSymbol: true, typeMatch: true }), 0)
    const fremd = scoreEvidence(evidence({ baseMatch: true, typeMatch: true }), 0)
    expect(echt - fremd).toBeGreaterThanOrEqual(12)
  })

  it('bestraft ein Instrument, das nicht zum eingestellten Markt passt', () => {
    // Markt „Krypto", Treffer ist eine Aktie: Genau so gewann die italienische
    // SOL S.p.A. gegen das Krypto-Paar Solana.
    const passend = scoreEvidence(evidence({ baseMatch: true, nameSim: 1, typeMatch: true }), 0)
    const unpassend = scoreEvidence(evidence({ baseMatch: true, nameSim: 1, typeMatch: false }), 0)
    expect(passend - unpassend).toBeGreaterThanOrEqual(30)
  })

  it('bestraft eine deterministische Übersetzung NIE für den eingestellten Markt', () => {
    // Im Bestand liegt alles unter „Aktien", auch Indizes. Würde `^GDAXI` dafür
    // bestraft, landete „DAX" auf einem DAX-ETF statt auf dem Index.
    const alias = evidence({ aliasDerived: true, nameSim: 0.5, typeMatch: false })
    const ohneMarktangabe = evidence({ aliasDerived: true, nameSim: 0.5, typeMatch: null })
    expect(scoreEvidence(alias, 55)).toBe(scoreEvidence(ohneMarktangabe, 55))
  })

  it('bleibt im Bereich 0 bis 100', () => {
    expect(
      scoreEvidence(evidence({ baseMatch: true, exactSymbol: true, nameSim: 1, typeMatch: true }), 55),
    ).toBeLessThanOrEqual(100)
    expect(scoreEvidence(evidence({ typeMatch: false }), 0)).toBeGreaterThanOrEqual(0)
  })
})
