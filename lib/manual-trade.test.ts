import { beforeEach, describe, expect, it, vi } from 'vitest'
const fakes = vi.hoisted(() => ({
  log: [] as string[], owned: true, demo: true,
  row: { demoIssue: null as string | null, version: 1, status: 'geplant', demoCheckedAt: null as Date | null },
  reconcile: vi.fn(), update: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: {
  select: () => ({ from: () => ({ where: async () => fakes.owned ? [fakes.row] : [] }) }),
  update: () => ({ set: (patch: object) => ({ where: async () => fakes.update(patch) }) }),
} }))
vi.mock('@/lib/demo-run', () => ({ runDemoFills: (...args: unknown[]) => fakes.reconcile(...args) }))
vi.mock('@/lib/trade-lock', () => ({ withTradeLock: async (_user: string, _id: number, fn: (row: unknown, depot: unknown) => Promise<unknown>) => {
  fakes.log.push('lock')
  return fn(fakes.row, { kind: fakes.demo ? 'demo' : 'echtgeld' })
} }))
import { withManualTrade } from './manual-trade'
const report = () => ({ error: null, ausstehend: [] as number[], unvollstaendig: [] as number[], ohneKerzen: [] as number[] })
beforeEach(() => {
  fakes.log = []; fakes.owned = true; fakes.demo = true; fakes.row = { demoIssue: null, version: 1, status: 'geplant', demoCheckedAt: null }
  fakes.update.mockReset()
  fakes.reconcile.mockReset().mockImplementation(async () => {
    fakes.log.push('reconciled-and-committed')
    return report()
  })
})
describe('Manuelle Eingriffe nach automatischer Ausführung', () => {
  it('akzeptiert reine Cursor-/Diagnoseupdates während desselben Speicherversuchs', async () => {
    fakes.reconcile.mockImplementation(async () => {
      Object.assign(fakes.row, { version: 2, demoCheckedAt: new Date(), demoIssue: 'Datenlücke' })
      return report()
    })
    const save = vi.fn(async () => 7)
    expect(await withManualTrade('user', 1, save, { expectedVersion: 1 })).toBe(7)
    expect(save).toHaveBeenCalledWith(2)
  })
  it('weist bereits vor dem Aufruf veraltete Versionen ohne Abgleich ab', async () => {
    await expect(withManualTrade('user', 1, async () => 7, { expectedVersion: 0 })).rejects.toThrow('inzwischen geändert')
    expect(fakes.reconcile).not.toHaveBeenCalled()
  })
  it('überschreibt keine zwischenzeitliche Ausführung oder Planänderung', async () => {
    fakes.reconcile.mockImplementation(async () => {
      Object.assign(fakes.row, { version: 2, status: 'aktiv' })
      return report()
    })
    const save = vi.fn(async () => 7)
    await expect(withManualTrade('user', 1, save, { expectedVersion: 1 })).rejects.toThrow('automatisch ausgeführt')
    expect(save).not.toHaveBeenCalled()
    expect(fakes.update).not.toHaveBeenCalled()
  })
  it('weist neue Teilfüllungen auch bei unverändertem Status zurück', async () => {
    fakes.reconcile.mockResolvedValue({ ...report(), zeilen: [{ art: 'teilziel' }] })
    const save = vi.fn(async () => 7)
    await expect(withManualTrade('user', 1, save, { expectedVersion: 1 })).rejects.toThrow('automatisch ausgeführt')
    expect(save).not.toHaveBeenCalled()
  })
  it('verbucht frühere Auslösungen vor dem manuellen Eingriff und setzt danach die neue Grenze', async () => {
    await withManualTrade('user', 1, async () => { fakes.log.push('manual'); return 7 })
    expect(fakes.log).toEqual(['reconciled-and-committed', 'lock', 'manual'])
    expect(fakes.update).toHaveBeenCalledWith({ demoBoundaryAt: expect.any(Date), demoIssue: null })
  })
  it('rollt eine schon verbuchte Automatik nicht bei ungültigen manuellen Angaben zurück', async () => {
    await expect(withManualTrade('user', 1, async () => { throw new Error('Rest schon geschlossen') }))
      .rejects.toThrow('Rest schon geschlossen')
    expect(fakes.log).toEqual(['reconciled-and-committed', 'lock'])
    expect(fakes.update).not.toHaveBeenCalled()
  })
  it('prüft Besitz bevor eine Ausführung angestoßen wird', async () => {
    fakes.owned = false
    await expect(withManualTrade('stranger', 1, async () => 0)).rejects.toThrow('Diesen Trade')
    expect(fakes.reconcile).not.toHaveBeenCalled()
  })
  it('lässt bei fehlenden Kursdaten manuelle Buchungen zu und hinterlässt eine sichtbare Warnung', async () => {
    fakes.reconcile.mockResolvedValue({ ...report(), error: 'Provider offline' })
    const manual = vi.fn(async () => 1)
    expect(await withManualTrade('user', 1, manual)).toBe(1)
    expect(fakes.update).toHaveBeenCalledWith({ demoBoundaryAt: expect.any(Date), demoIssue: 'Ungeprüfte Historie: Provider offline' })
  })
  it('arbeitet bekannte Historie in begrenzten Seiten vor der Planänderung ab', async () => {
    fakes.reconcile.mockResolvedValueOnce({ ...report(), ausstehend: [1] }).mockResolvedValueOnce(report())
    await withManualTrade('user', 1, async () => 1)
    expect(fakes.reconcile).toHaveBeenNthCalledWith(2, { userId: 'user', tradeId: 1, refresh: false })
  })
  it('setzt für Echtgeld keine Demo-Grenze', async () => {
    fakes.demo = false
    await withManualTrade('user', 1, async () => 1)
    expect(fakes.update).not.toHaveBeenCalled()
  })
})
