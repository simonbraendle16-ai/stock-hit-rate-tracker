/**
 * Welche Zeichen ein Ticker und ein Anbieter-Symbol tragen dürfen.
 *
 * **Warum das eine eigene Datei ist.** Die Prüfung stand doppelt in
 * `/api/quote` und `/api/candles` — und die beiden Muster waren VERSCHIEDEN.
 * Das war kein Schönheitsfehler, sondern ein stiller Totalausfall:
 *
 *   - `/api/quote` erlaubte kein `=` und kein `^`. Damit fiel dort **jeder
 *     Terminkontrakt und jeder Index** durch, also genau die Werte, für die
 *     Etappe 9 die Übersetzung überhaupt gebaut hat: `CL=F` (Öl), `GC=F`
 *     (Gold), `SI=F` (Silber), `YM=F`, `^GSPC`, `^GDAXI`, `^NDX`.
 *   - Beide erlaubten kein `!` und kein Leerzeichen. Damit scheiterte schon der
 *     **Rohticker**, bevor er übersetzt werden konnte: `CL1!` und `YM1!` sind
 *     TradingView-Notation (und in `symbol-aliases.ts` ausdrücklich vorgesehen),
 *     `NOVO_B` trägt einen Unterstrich, und ein Trade darf als Ticker
 *     schreiben, was der Nutzer eingetippt hat — im Bestand steht
 *     `THE TRADE DESK` mit Leerzeichen.
 *
 * Die Folge war eine Fehlermeldung „Ungültiges Symbol." an einer aktiven
 * Position: Die App behauptete, der Wert sei kaputt, obwohl die Auflösung in
 * der Datenbank korrekt war und der Kurs im Speicher lag.
 *
 * **Die Lehre steckt in der Trennung der beiden Funktionen.** Es sind zwei
 * verschiedene Fragen, und sie gehören an zwei verschiedene Stellen:
 *
 *   1. `istGueltigerTicker` — was ein NUTZER eingetippt haben darf. Großzügig,
 *      denn es ist nur eine Absicht, die gleich übersetzt wird. Geprüft wird
 *      hier gegen Unsinn und gegen Zeichen, die in einer URL gefährlich wären.
 *   2. `istGueltigesAnbieterSymbol` — was TATSÄCHLICH an den Anbieter geht.
 *      Eng, und geprüft **nach** der Auflösung. Vorher zu prüfen heißt, den
 *      Rohticker an einem Maßstab zu messen, den erst sein Ergebnis erfüllen
 *      muss.
 *
 * Rein und getestet; kein Netz, keine Datenbank.
 */

/** Länger als das ist kein Ticker mehr, sondern eine Verwechslung. */
export const MAX_TICKER_LAENGE = 32
/** Anbieter-Symbole sind kurz — `BRK-B`, `1810.HK`, `^GDAXI`, `CL=F`. */
export const MAX_ANBIETER_SYMBOL_LAENGE = 24

/**
 * Zeichen, die in einem eingetippten Ticker vorkommen dürfen.
 *
 * Enthalten sind bewusst `!` (TradingViews fortlaufender Kontrakt, `CL1!`),
 * `_` (`NOVO_B`), `/` (Währungspaare wie `EUR/USD`), `:` (Börsenpräfix wie
 * `NASDAQ:AAPL`), `=` und `^` (wer sein Anbieter-Symbol direkt einträgt) sowie
 * das **Leerzeichen** (Altbestand trägt ganze Namen als Ticker).
 */
const TICKER_MUSTER = /^[A-Z0-9 ._:^=!/-]+$/

/**
 * Zeichen, die ein aufgelöstes Anbieter-Symbol tragen darf.
 *
 * Kein Leerzeichen, kein `!`: Was hier durchgeht, wird an Yahoo & Co. gereicht
 * und muss dort existieren können. Ein `!` hat es nie bis zum Anbieter zu
 * schaffen — steht eines drin, hat die Auflösung nicht stattgefunden.
 */
const ANBIETER_MUSTER = /^[A-Z0-9.:^=-]+$/

/**
 * Ist das eine plausible Nutzereingabe?
 *
 * Prüft die Form, nicht die Existenz — ob es den Wert gibt, beantwortet erst
 * der Anbieter. Leer, zu lang oder mit fremden Zeichen ist `false`.
 */
export function istGueltigerTicker(roh: string | null | undefined): boolean {
  if (typeof roh !== 'string') return false
  const t = roh.trim().toUpperCase()
  if (t.length === 0 || t.length > MAX_TICKER_LAENGE) return false
  return TICKER_MUSTER.test(t)
}

/**
 * Darf dieses Symbol an einen Anbieter gehen?
 *
 * Zu prüfen **nach** der Auflösung. Schlägt sie fehl, ist das Ergebnis der
 * Rohticker (bewusster Rückfall, siehe `lookup.ts`) — und ein Rohticker wie
 * `CL1!` oder `THE TRADE DESK` fällt hier durch. Genau das ist der Zweck: Er
 * soll gar nicht erst abgefragt werden, denn eine Antwort darauf wäre im
 * besten Fall leer und im schlimmsten ein **fremdes Papier**.
 */
export function istGueltigesAnbieterSymbol(roh: string | null | undefined): boolean {
  if (typeof roh !== 'string') return false
  const t = roh.trim().toUpperCase()
  if (t.length === 0 || t.length > MAX_ANBIETER_SYMBOL_LAENGE) return false
  return ANBIETER_MUSTER.test(t)
}

/**
 * Die Meldung, wenn ein Symbol nicht abfragbar ist.
 *
 * Bewusst nicht „Ungültiges Symbol." — das schob die Schuld auf den Wert und
 * ließ den Nutzer im Instrument suchen, während in Wahrheit die **Verknüpfung**
 * fehlte. Der Text nennt deshalb den Wert und den nächsten Handgriff.
 */
export function unaufgeloestMeldung(ticker: string): string {
  return (
    `„${ticker.trim()}" ist keinem Anbieter-Symbol zugeordnet. ` +
    'Lege das Instrument in der Watchlist an oder verknüpfe den Trade damit — ' +
    'dann kommen Kurs und Kerzen.'
  )
}
