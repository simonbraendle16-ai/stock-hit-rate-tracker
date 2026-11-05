import {afterEach, expect, it, vi} from 'vitest'
import {NextRequest} from 'next/server'
import {maintenanceWindowOpen} from './maintenance-window'
const state=vi.hoisted(()=>({due:vi.fn(),alerts:vi.fn(),demo:vi.fn()}))
vi.mock('@/lib/background-activity',()=>({backgroundDue:state.due}))
vi.mock('@/lib/alert-run',()=>({runAlertCheck:state.alerts}))
vi.mock('@/lib/demo-cycle',()=>({configuredDemoScope:()=>({userId:'synthetic',portfolioId:1}),runDemoCycle:state.demo}))
import {GET as alertsGET} from '@/app/api/cron/check-alerts/route'
import {GET as demoGET} from '@/app/api/cron/demo-cycle/route'
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.resetAllMocks()})
it('accepts exactly four scheduled delivery windows per hour including delayed delivery',()=>{
 const base=Date.parse('2026-11-05T10:00:00Z')
 expect(Array.from({length:12},(_,i)=>maintenanceWindowOpen(base+i*300000+30000)).filter(Boolean)).toHaveLength(4)
 expect(maintenanceWindowOpen(base+299999)).toBe(true)
 expect(maintenanceWindowOpen(base+300000)).toBe(false)
 expect(maintenanceWindowOpen(base+3600000)).toBe(true)
 expect(maintenanceWindowOpen(NaN)).toBe(false)
})
it.each(['alerts','demo'])('%s skips outside windows without touching the activity database or business runner',async kind=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-05T10:05:30Z'))
 vi.stubEnv('ALERT_CRON_SECRET','synthetic');vi.stubEnv('DEMO_CYCLE_SECRET','synthetic')
 const get=kind==='alerts'?alertsGET:demoGET
 const request=(token:string)=>new NextRequest('http://localhost/api/cron/'+kind,{headers:{authorization:'Bearer '+token}})
 expect((await get(request('wrong'))).status).toBe(401)
 const r=await get(request('synthetic'));expect(r.status).toBe(200)
 expect(await r.json()).toMatchObject({ran:false,skipped:'reduced_schedule',intervalMinutes:15})
 expect(state.due).not.toHaveBeenCalled();expect(state.alerts).not.toHaveBeenCalled();expect(state.demo).not.toHaveBeenCalled()
})
it.each(['alerts','demo'])('%s keeps authenticated manual work immediate and admitted work behind its existing gate',async kind=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-05T10:05:30Z'))
 vi.stubEnv('ALERT_CRON_SECRET','synthetic');vi.stubEnv('DEMO_CYCLE_SECRET','synthetic')
 state.due.mockResolvedValue(true);state.alerts.mockResolvedValue({complete:true});state.demo.mockResolvedValue({accepted:true})
 const get=kind==='alerts'?alertsGET:demoGET
 const req=new NextRequest('http://localhost/api/cron/'+kind+(kind==='demo'?'?manual=1':''),{headers:{authorization:'Bearer synthetic',...(kind==='alerts'?{'x-alert-check-origin':'manual'}:{})}})
 expect((await get(req)).status).toBe(200);expect(state.due).not.toHaveBeenCalled()
 expect(kind==='alerts'?state.alerts:state.demo).toHaveBeenCalledTimes(1)
 vi.setSystemTime(new Date('2026-11-05T10:15:30Z'))
 state.due.mockResolvedValue(false)
 const gated=await get(new NextRequest('http://localhost/api/cron/'+kind,{headers:{authorization:'Bearer synthetic'}}))
 expect(await gated.json()).toMatchObject({ran:false,skipped:'inactive_interval'})
 expect(state.due).toHaveBeenCalledTimes(1)
 expect(kind==='alerts'?state.alerts:state.demo).toHaveBeenCalledTimes(1)
})
