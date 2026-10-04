import { NextRequest, NextResponse } from 'next/server'
import { runScheduledDemoFills } from '@/lib/demo-schedule'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET ist nicht gesetzt.' }, { status: 500 })
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Nicht berechtigt.' }, { status: 401 })
  }
  try {
    const report = await runScheduledDemoFills(req.nextUrl.searchParams.get('force') === '1')
    const ok = !report.error && !report.unvollstaendig.length && !report.ohneKerzen.length
    return NextResponse.json({ ok, ...report }, { status: report.error ? 503 : 200 })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 503 })
  }
}
