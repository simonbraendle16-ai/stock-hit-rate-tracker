import { expect, it, vi } from 'vitest'
import { AnalysisAutoRefresh } from '../components/analysis-auto-refresh'
import { QuoteAutoRefresh } from '../components/quote-auto-refresh'
it('analysis and wave pages install no timers, focus handlers or quote effects', () => {
  const interval = vi.spyOn(globalThis, 'setInterval')
  expect(AnalysisAutoRefresh()).toBeNull()
  expect(QuoteAutoRefresh()).toBeNull()
  expect(interval).not.toHaveBeenCalled()
  interval.mockRestore()
})
