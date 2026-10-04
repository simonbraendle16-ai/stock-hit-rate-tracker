import type { ContractSpec } from './contract-specs'

/** A known contract supplies its currency without waiting for an external resolver. */
export async function resolveTradeFormInstrument(
  resolveSpec: () => Promise<ContractSpec | null>,
  resolveCurrency: () => Promise<string | null>,
) {
  const spec = await resolveSpec()
  return { spec, currency: spec?.currency ?? await resolveCurrency() }
}
