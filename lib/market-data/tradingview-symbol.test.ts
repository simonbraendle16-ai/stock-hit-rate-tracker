import { describe, expect, it } from 'vitest'
import { FUTURES_ROOTS } from './symbol-aliases'
import {
  FUTURES_TV_EXCHANGE,
  FUTURES_TV_FREI,
  futuresRootsOhneTvBoerse,
  toTradingViewSymbol,
} from './tradingview-symbol'

const tv = (ticker: string, market = 'aktien', exchange?: string | null) =>
  toTradingViewSymbol(ticker, market, null, exchange)

describe('toTradingViewSymbol', () => {
  it('nimmt für den fortlaufenden Kontrakt die frei abrufbare Notierung', () => {
    // Der ursprüngliche Fehlerfall: Ohne Präfix zeigte TradingView `ASX24:CL1!`
    // — ein australisches Stromzertifikat statt WTI-Öl. `NYMEX:CL1!` wäre zwar
    // richtig benannt, bleibt im Gratis-Embed aber leer; `TVC:USOIL` ist
    // derselbe Basiswert und liefert Kerzen.
    expect(tv('CL1!', 'rohstoffe')).toBe('TVC:USOIL')
    expect(tv('GC1!', 'rohstoffe')).toBe('TVC:GOLD')
    expect(tv('SI1!', 'rohstoffe')).toBe('TVC:SILVER')
    expect(tv('BZ1!', 'rohstoffe')).toBe('TVC:UKOIL')
  })

  it('setzt die Börse davor, wo es keine freie Entsprechung gibt', () => {
    expect(tv('ES1!', 'aktien')).toBe('CME:ES1!')
    expect(tv('ZW1!', 'rohstoffe')).toBe('CBOT:ZW1!')
    expect(tv('KC1!', 'rohstoffe')).toBe('ICEUS:KC1!')
    // Erdgas, Kupfer und Dollar-Index blieben als TVC-Notierung leer.
    expect(tv('NG1!', 'rohstoffe')).toBe('NYMEX:NG1!')
    expect(tv('HG1!', 'rohstoffe')).toBe('COMEX:HG1!')
    expect(tv('DX1!', 'rohstoffe')).toBe('ICEUS:DX1!')
  })

  it('bleibt bei einem bestimmten Kontrakt exakt', () => {
    // Wer `CL2!` tippt, meint diesen Kontrakt — nicht den Basiswert.
    expect(tv('CL2!', 'rohstoffe')).toBe('NYMEX:CL2!')
  })

  it('ergänzt die Kontraktkennung nur bei Rohstoffen', () => {
    expect(tv('CL', 'rohstoffe')).toBe('TVC:USOIL')
    // `SI` ist auch ein Aktienkürzel — ohne `!` darf daraus kein Silber-Future
    // werden, sonst zeigt der Chart ein fremdes Instrument.
    expect(tv('SI', 'aktien')).toBe('SI')
    expect(tv('PL', 'aktien')).toBe('PL')
  })

  it('löst Spotnotierungen auf denselben Basiswert auf', () => {
    expect(tv('USOIL', 'rohstoffe')).toBe('TVC:USOIL')
    expect(tv('XAUUSD', 'rohstoffe')).toBe('TVC:GOLD')
    expect(tv('NATGAS', 'rohstoffe')).toBe('NYMEX:NG1!')
  })

  it('übersetzt Indizes in allen gebräuchlichen Schreibweisen', () => {
    expect(tv('DAX')).toBe('XETR:DAX')
    expect(tv('GER40')).toBe('XETR:DAX')
    expect(tv('^GDAXI')).toBe('XETR:DAX')
    expect(tv('SPX')).toBe('TVC:SPX')
    expect(tv('US500')).toBe('TVC:SPX')
    expect(tv('NDX')).toBe('NASDAQ:NDX')
    expect(tv('VIX')).toBe('TVC:VIX')
  })

  it('nimmt die Börse aus der gespeicherten Auflösung', () => {
    expect(tv('AAPL', 'aktien', 'NMS')).toBe('NASDAQ:AAPL')
    expect(tv('KO', 'aktien', 'NYQ')).toBe('NYSE:KO')
    // Yahoo-Suffix gehört nicht ins TradingView-Symbol.
    expect(tv('ADS.DE', 'aktien', 'GER')).toBe('XETR:ADS')
  })

  // In `stock.resolvedExchange` steht Yahoos KLARNAME, nicht das Kürzel. Die
  // Werte hier sind aus der Datenbank abgeschrieben — ein Test auf `'GER'`
  // allein war grün, während in der App jedes deutsche Papier als `RHM.DE` ans
  // Widget ging und dort nicht existierte.
  it('versteht auch Yahoos ausgeschriebene Börsennamen', () => {
    expect(tv('RHM.DE', 'aktien', 'XETRA')).toBe('XETR:RHM')
    expect(tv('HEN3.DE', 'aktien', 'XETRA')).toBe('XETR:HEN3')
    expect(tv('AIR.PA', 'aktien', 'Paris')).toBe('EURONEXT:AIR')
    expect(tv('1810.HK', 'aktien', 'HKSE')).toBe('HKEX:1810')
    expect(tv('AAPL', 'aktien', 'NasdaqGS')).toBe('NASDAQ:AAPL')
    expect(tv('CRSP', 'aktien', 'NasdaqGM')).toBe('NASDAQ:CRSP')
    expect(tv('LIT', 'etf', 'NYSEArca')).toBe('AMEX:LIT')
    // Leerzeichen im Namen dürfen nicht am Vergleich scheitern.
    expect(tv('DRO.AX', 'aktien', 'ASX')).toBe('ASX:DRO')
    expect(tv('AUMC.V', 'aktien', 'Cboe CA')).toBe('NEO:AUMC')
  })

  it('leitet die Börse notfalls aus dem Yahoo-Suffix ab', () => {
    // Ohne Börsenangabe wäre der Rohticker kein „raten lassen", sondern ein
    // sicherer Fehlschlag: `RHM.DE` kennt TradingView nicht.
    expect(tv('RHM.DE', 'aktien')).toBe('XETR:RHM')
    expect(tv('AIR.PA', 'aktien', 'Unbekannte Börse')).toBe('EURONEXT:AIR')
    expect(tv('AUMC.V', 'aktien')).toBe('TSXV:AUMC')
    expect(tv('BARC.L', 'aktien')).toBe('LSE:BARC')
  })

  it('lässt den Ticker unangetastet, wenn die Börse unbekannt ist', () => {
    // Lieber wie bisher raten lassen als ein falsches Präfix erfinden — das
    // gilt aber nur für Ticker OHNE Suffix, die TradingView selbst findet.
    expect(tv('AAPL', 'aktien')).toBe('AAPL')
    expect(tv('AAPL', 'aktien', 'IRGENDWAS')).toBe('AAPL')
  })

  it('behandelt Krypto und Forex wie zuvor', () => {
    expect(tv('BTCUSDT', 'krypto')).toBe('BINANCE:BTCUSDT')
    expect(tv('BTC', 'krypto')).toBe('BINANCE:BTCUSDT')
    expect(tv('EUR/USD', 'forex')).toBe('FX:EURUSD')
    expect(tv('EURUSD', 'rohstoffe')).toBe('OANDA:EURUSD')
  })

  it('lässt ein bereits vollqualifiziertes Symbol unverändert', () => {
    expect(tv('NASDAQ:AAPL', 'aktien', 'NYQ')).toBe('NASDAQ:AAPL')
  })

  it('gibt dem gespeicherten Chart-Link den Vorrang vor jeder Ableitung', () => {
    expect(
      toTradingViewSymbol(
        'CL1!',
        'rohstoffe',
        'https://www.tradingview.com/chart/?symbol=NYMEX%3ACL1!',
      ),
    ).toBe('NYMEX:CL1!')
  })

  it('fällt bei kaputtem Chart-Link auf die Ableitung zurück', () => {
    expect(toTradingViewSymbol('CL1!', 'rohstoffe', 'kein-link')).toBe('TVC:USOIL')
  })
})

describe('FUTURES_TV_EXCHANGE', () => {
  it('deckt jede Wurzel aus FUTURES_ROOTS ab', () => {
    // Beide Tabellen müssen zusammen wachsen: Eine Wurzel ohne TradingView-
    // Börse liefert wieder den mehrdeutigen Rohticker.
    expect(futuresRootsOhneTvBoerse()).toEqual([])
    expect(Object.keys(FUTURES_TV_EXCHANGE).sort()).toEqual(Object.keys(FUTURES_ROOTS).sort())
  })

  it('kennt zu jeder freien Entsprechung auch die Börsenform', () => {
    // Sonst stünde für `CL2!` plötzlich `undefined:CL2!` im Widget.
    for (const root of Object.keys(FUTURES_TV_FREI)) {
      expect(FUTURES_TV_EXCHANGE[root]).toBeTruthy()
    }
  })
})
