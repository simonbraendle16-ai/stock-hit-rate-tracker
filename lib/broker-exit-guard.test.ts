import { describe, expect, it } from 'vitest'
import { classifyBrokerExit, hasConfirmedBrokerEntry } from './broker-exit-guard'

const order = { id: 17, quantity: 4, executionPrice: 126.5 }
const opening = { type: 'eroeffnet', quantity: 4, price: 126.5,
  payload: JSON.stringify({ source: 'broker', brokerOrderId: 17 }) }

describe('Broker-Ausstiegsschutz', () => {
  it('schließt nur die exakt verbleibende Menge', () => {
    expect(classifyBrokerExit(4, 4)).toBe('closed')
    expect(classifyBrokerExit(4, 1)).toBe('partial')
    expect(classifyBrokerExit(4, 4.5)).toBe('unresolved')
    expect(classifyBrokerExit(0, 1)).toBe('unresolved')
  })

  it('verlangt den bestätigten Einstieg aus genau diesem Brokerbeleg', () => {
    expect(hasConfirmedBrokerEntry(order, [opening])).toBe(true)
    expect(hasConfirmedBrokerEntry({ ...order, id: 18 }, [opening])).toBe(false)
    expect(hasConfirmedBrokerEntry(order, [{ ...opening, quantity: 3 }])).toBe(false)
    expect(hasConfirmedBrokerEntry(order, [{ ...opening, payload: null }])).toBe(false)
  })

  it('lässt manuell geänderte Positionsgrößen ungeklärt', () => {
    expect(hasConfirmedBrokerEntry(order, [opening, { type: 'nachkauf', quantity: 1,
      price: 130, payload: null }])).toBe(false)
    expect(hasConfirmedBrokerEntry(order, [opening, { type: 'teilverkauf', quantity: 1,
      price: 130, payload: null }])).toBe(false)
    expect(hasConfirmedBrokerEntry(order, [opening, { type: 'teilverkauf', quantity: 1,
      price: 130, payload: '{"source":"broker"}' }])).toBe(true)
  })
})
