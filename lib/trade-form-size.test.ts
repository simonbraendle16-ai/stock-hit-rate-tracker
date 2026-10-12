import { describe, expect, it } from 'vitest'
import { manualPositionSize, updateSizeForm } from './trade-form-size'

describe('trade form quantity source', () => {
  it('does not send a conflicting or rounded manual quantity alongside capital', () => {
    expect(manualPositionSize({ investedAmount: '1056.2', contracts: '', positionSize: '7' })).toBeNull()
  })
  it('keeps manual quantity available without capital', () => {
    expect(manualPositionSize({ investedAmount: '', contracts: '', positionSize: '7.5' })).toBe(7.5)
  })
  it('removes the hidden manual value when capital is entered and does not restore it when cleared', () => {
    const start = { investedAmount: '', contracts: '', positionSize: '7' }
    const capital = updateSizeForm(start, 'investedAmount', '1056.2')
    expect(capital.positionSize).toBe('')
    expect(manualPositionSize(updateSizeForm(capital, 'investedAmount', ''))).toBeNull()
    expect(start.positionSize).toBe('7')
  })
  it('lets contract specifications determine quantity', () => {
    const form = updateSizeForm({ investedAmount: '', contracts: '', positionSize: '99' }, 'contracts', '2')
    expect(form.positionSize).toBe('')
    expect(manualPositionSize(form)).toBeNull()
  })
})
