import {it,expect,vi,beforeEach} from 'vitest'
import {NextRequest} from 'next/server'
const state=vi.hoisted(()=>({user:true,record:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:{api:{getSession:async()=>state.user?{user:{id:'synthetic'}}:null}}}))
vi.mock('@/lib/background-activity',()=>({recordAppActivity:state.record}))
import {POST} from '@/app/api/activity/route'
beforeEach(()=>{state.user=true;state.record.mockReset();state.record.mockResolvedValue({enabled:true,active:true,intervalMinutes:15})})
it('accepts authenticated same-host activity behind an internal Next.js origin',async()=>{const r=await POST(new NextRequest('http://localhost:3000/api/activity',{method:'POST',headers:{host:'app.example',origin:'https://app.example','sec-fetch-site':'same-origin'}}));expect(r.status).toBe(200);expect(state.record).toHaveBeenCalledTimes(1)})
it('rejects cross-site and unauthenticated activity',async()=>{expect((await POST(new NextRequest('https://app.example/api/activity',{method:'POST',headers:{origin:'https://other.example',host:'app.example'}}))).status).toBe(403);state.user=false;expect((await POST(new NextRequest('https://app.example/api/activity',{method:'POST'}))).status).toBe(401);expect(state.record).not.toHaveBeenCalled()})

it('returns the atomic activity status without a second status reader',async()=>{
 const status={enabled:true,active:true,intervalMinutes:15,lastActivity:'synthetic-time'};state.record.mockResolvedValue(status);
 const r=await POST(new NextRequest('https://app.example/api/activity',{method:'POST'}));expect(await r.json()).toEqual(status);expect(r.headers.get('cache-control')).toBe('no-store');
})
