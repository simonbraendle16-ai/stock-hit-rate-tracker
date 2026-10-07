import { ApiError, apiResponseError, requireApiScope } from '@/lib/assistant-api'
import { knowledgeManifest } from '@/lib/knowledge-manifest'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.search) throw new ApiError(400, 'Manifest erlaubt keine Filter oder Seitenauswahl.')
    const owner = await requireApiScope(req, 'trades:read')
    const journalOwner = await requireApiScope(req, 'journal:read')
    if (owner !== journalOwner) throw new ApiError(403, 'Unvereinbarer Quellenbesitz.')
    const result = await knowledgeManifest(owner)
    const headers = { ETag: result.etag, 'Cache-Control': 'private, no-cache', Vary: 'Authorization' }
    const tags = req.headers.get('if-none-match')?.split(',').map(t => t.trim().replace(/^W\//, '')) ?? []
    if (tags.includes(result.etag) || tags.includes('*')) return new NextResponse(null, { status: 304, headers })
    return NextResponse.json({ items: result.items, complete: true, schemaVersion: result.schemaVersion }, { headers })
  } catch (cause) { return apiResponseError(cause) }
}
