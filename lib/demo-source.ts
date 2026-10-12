export type DemoSource = {
  providerSymbol: string | null
  resolutionStatus: string | null
  resolutionApproximate: boolean | null
  market: string
}

/** Simulation requires the confirmed instrument, never a substitute contract. */
export function demoSourceIssue(source: DemoSource | null | undefined, market: string, ticker?: string): string | null {
  if (!source?.providerSymbol || source.resolutionStatus !== 'ok') {
    return 'Symbolzuordnung unbestätigt. Bitte das genaue Instrument zuordnen; keine automatische Ausführung.'
  }
  if (source.resolutionApproximate || (/^XAU\/?USD$/i.test(ticker ?? '') && source.providerSymbol !== 'XAUUSD')) {
    return 'Kursquelle ist eine Näherung (z. B. Future statt Spot). Exakte Kursquelle erforderlich; automatische Ausführung pausiert.'
  }
  if (source.market !== market) {
    return 'Anlageklasse von Trade und Instrument widerspricht sich. Bitte die Zuordnung prüfen; automatische Ausführung pausiert.'
  }
  return null
}
