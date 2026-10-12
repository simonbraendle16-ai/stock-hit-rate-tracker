/** Capital or contracts determine quantity; never submit a stale manual assertion too. */
export function manualPositionSize(form: { investedAmount: string; contracts: string; positionSize: string }): number | null {
  if (form.investedAmount.trim() || form.contracts.trim()) return null
  return form.positionSize.trim() ? Number(form.positionSize) : null
}

/** Switching to a derived quantity must not leave a hidden manual value behind. */
export function updateSizeForm<T extends { investedAmount: string; contracts: string; positionSize: string }>(
  form: T, key: keyof T, value: string,
): T {
  const next = { ...form, [key]: value }
  if ((key === 'investedAmount' || key === 'contracts') && value.trim()) next.positionSize = ''
  return next
}
