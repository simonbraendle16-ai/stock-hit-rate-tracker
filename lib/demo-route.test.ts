import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const scheduled = vi.hoisted(() => vi.fn())
vi.mock('@/lib/demo-schedule', () => ({ runScheduledDemoFills: scheduled }))
import { GET } from '@/app/api/cron/demo-fills/route'
const originalSecret = process.env.CRON_SECRET
const report = () => ({ ran: true, error: null, unvollstaendig: [], ohneKerzen: [], ausstehend: [] })
const request = (token?: string, force = false) => new NextRequest(`http://localhost/api/cron/demo-fills${force ? '?force=1' : ''}`, {
  headers: token ? { authorization: `Bearer ${token}` } : {},
})
beforeEach(() => { process.env.CRON_SECRET = 'test-only-secret'; scheduled.mockReset().mockResolvedValue(report()) })
afterEach(() => { if (originalSecret == null) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = originalSecret })
describe('Geschützter Hintergrund-Endpunkt', () => {
  it('startet ohne eingerichtetes Geheimnis keine Ausführung', async () => {
    delete process.env.CRON_SECRET
    expect((await GET(request())).status).toBe(500)
    expect(scheduled).not.toHaveBeenCalled()
  })
  it('weist einen unberechtigten Force-Aufruf ab', async () => {
    expect((await GET(request('wrong-secret', true))).status).toBe(401)
    expect(scheduled).not.toHaveBeenCalled()
  })
  it('übergibt die Fälligkeit nur nach erfolgreicher Authentifizierung', async () => {
    const response = await GET(request('test-only-secret', true))
    expect(response.status).toBe(200)
    expect(scheduled).toHaveBeenCalledWith(true)
    expect((await response.json()).ok).toBe(true)
  })
  it('stellt fehlende Kursdaten nicht als vollständig erfolgreichen Lauf dar', async () => {
    scheduled.mockResolvedValue({ ...report(), unvollstaendig: [1] })
    const response = await GET(request('test-only-secret'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: false, unvollstaendig: [1] })
  })
  it('meldet einen Ausführungsfehler explizit an den Taktgeber', async () => {
    scheduled.mockResolvedValue({ ...report(), error: 'offline' })
    expect((await GET(request('test-only-secret'))).status).toBe(503)
    scheduled.mockRejectedValue(new Error('database offline'))
    expect(await (await GET(request('test-only-secret'))).json()).toMatchObject({ ok: false, error: 'database offline' })
  })
})
