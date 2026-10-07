import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { fingerprint } from './knowledge-content.mjs'
const mocks = vi.hoisted(() => ({ scope: vi.fn(), manifest: vi.fn() }))
vi.mock('@/lib/assistant-api', async (importOriginal) => ({ ...await importOriginal<object>(), requireApiScope: mocks.scope }))
vi.mock('@/lib/knowledge-manifest', () => ({ knowledgeManifest: mocks.manifest }))
import { GET } from '@/app/api/assistant/v1/knowledge/manifest/route'

describe('knowledge manifest route', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.scope.mockResolvedValue('owner'); mocks.manifest.mockResolvedValue({ etag: '"abc"', items: [], complete: true, schemaVersion: 1 }) })
  it('requires both read scopes before manifest and ETag handling', async () => {
    const { ApiError } = await import('@/lib/assistant-api')
    mocks.scope.mockRejectedValue(new ApiError(401, 'API-Token fehlt.'))
    expect((await GET(new NextRequest('https://test/api/assistant/v1/knowledge/manifest', { headers: { 'if-none-match': '*' } }))).status).toBe(401)
    expect(mocks.manifest).not.toHaveBeenCalled()
    mocks.scope.mockReset().mockResolvedValueOnce('owner').mockRejectedValueOnce(new ApiError(403, 'Recht fehlt.'))
    expect((await GET(new NextRequest('https://test/api/assistant/v1/knowledge/manifest'))).status).toBe(403)
    expect(mocks.manifest).not.toHaveBeenCalled()
  })
  it('passes only authenticated owner and supports 304 including weak ETags', async () => {
    const response = await GET(new NextRequest('https://test/api/assistant/v1/knowledge/manifest', { headers: { 'if-none-match': 'W/"abc"' } }))
    expect(response.status).toBe(304); expect(await response.text()).toBe('')
    expect(mocks.manifest).toHaveBeenCalledWith('owner')
    expect(mocks.scope.mock.calls.map(c => c[1])).toEqual(['trades:read', 'journal:read'])
  })
  it('rejects partial or foreign-user filters', async () => {
    expect((await GET(new NextRequest('https://test/api/assistant/v1/knowledge/manifest?userId=foreign'))).status).toBe(400)
    expect(mocks.manifest).not.toHaveBeenCalled()
  })
})
describe('search fingerprint', () => {
  it('detects old edits, nested events and event corrections independently of parent version', () => {
    const trade = { id: 1, version: 1, notes: 'original', planContext: { trigger: 'old' }, events: [{ id: 1, note: 'original' }], eventRevisions: [] }
    const original = fingerprint('trade', trade)
    expect(fingerprint('trade', { ...trade, notes: 'corrected' })).not.toBe(original)
    expect(fingerprint('trade', { ...trade, events: [{ id: 1, note: 'corrected' }] })).not.toBe(original)
    expect(fingerprint('trade', { ...trade, eventRevisions: [{ id: 1, reason: 'correction' }] })).not.toBe(original)
    expect(fingerprint('trade', { ...trade, userId: 'secret', externalRequestHash: 'secret', demoCheckedAt: new Date() })).toBe(original)
    expect(fingerprint('journal', { id: 'old', version: 1, situation: 'old' })).not.toBe(fingerprint('journal', { id: 'old', version: 1, situation: 'new' }))
    expect(fingerprint('insight', { id: 'old', version: 1, counterEvidenceRefs: [] })).not.toBe(fingerprint('insight', { id: 'old', version: 1, counterEvidenceRefs: [{ id: 'proof', kind: 'journal' }] }))
  })
})
