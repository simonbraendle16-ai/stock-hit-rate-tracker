type EntryEvidence = { type: string; quantity: number | null; price: number | null; payload: string | null }

export function hasConfirmedBrokerEntry(
  order: { id: number; quantity: number | null; executionPrice: number | null },
  events: EntryEvidence[],
) {
  const opened = events.find((event) => event.type === 'eroeffnet')
  if (!opened || !order.quantity || !order.executionPrice ||
      opened.quantity !== order.quantity || opened.price !== order.executionPrice) return false
  // Eine manuelle Größenänderung kann nicht derselben einzelnen Brokerposition
  // zugerechnet werden. Der Ausstieg bleibt bis zur Klärung ein Brokerbeleg.
  if (events.some((event) => event.type === 'nachkauf' ||
      (event.type === 'teilverkauf' && !isBrokerPayload(event.payload)))) return false
  try {
    const payload = JSON.parse(opened.payload ?? '')
    return payload?.source === 'broker' && payload?.brokerOrderId === order.id
  } catch { return false }
}

function isBrokerPayload(raw: string | null) {
  try { return JSON.parse(raw ?? '')?.source === 'broker' } catch { return false }
}

export function classifyBrokerExit(remaining: number, quantity: number): 'unresolved' | 'partial' | 'closed' {
  if (!Number.isFinite(remaining) || !Number.isFinite(quantity) || remaining <= 0 || quantity <= 0) return 'unresolved'
  const tolerance = Math.max(1e-8, remaining * 1e-6)
  if (quantity > remaining + tolerance) return 'unresolved'
  return Math.abs(quantity - remaining) <= tolerance ? 'closed' : 'partial'
}
