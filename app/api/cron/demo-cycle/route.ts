import { NextRequest, NextResponse } from 'next/server'
import { alertCronAuthorized } from '@/lib/alert-cron-auth'
import { configuredDemoScope, runDemoCycle } from '@/lib/demo-cycle'

export const dynamic='force-dynamic'
export const maxDuration=60

export async function GET(req: NextRequest) {
  const secret=process.env.DEMO_CYCLE_SECRET, scope=configuredDemoScope()
  if (!secret || !scope) return NextResponse.json({accepted:false,error:'Eigener Demozeitgeber nicht konfiguriert.'},{status:503})
  if (!alertCronAuthorized(req.headers.get('authorization'),secret)) return NextResponse.json({accepted:false,error:'Nicht berechtigt.'},{status:401})
  if ([...req.nextUrl.searchParams.keys()].some(key=>key!=='manual') || (req.nextUrl.searchParams.has('manual')&&req.nextUrl.searchParams.get('manual')!=='1')) {
    return NextResponse.json({accepted:false,error:'Nur serverseitig gebundenes Depot; keine freie Scope-/Force-Auswahl.'},{status:400})
  }
  try {
    return NextResponse.json(await runDemoCycle(scope,req.nextUrl.searchParams.get('manual')==='1'?'manual':'automatic'))
  } catch {
    return NextResponse.json({accepted:false,error:'Demozyklus technisch fehlgeschlagen; gespeicherten Depotstatus prüfen.'},{status:503})
  }
}
