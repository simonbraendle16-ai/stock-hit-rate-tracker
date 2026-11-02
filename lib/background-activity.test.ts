import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import {drizzle} from 'drizzle-orm/pglite'
import {readFileSync} from 'node:fs'
const state=vi.hoisted(()=>({db:null as any}))
vi.mock('@/lib/db',()=>({get db(){return state.db}}))
import {backgroundDue,recordAppActivity,backgroundActivityStatus} from './background-activity'
let pg:PGlite
beforeAll(async()=>{pg=new PGlite();state.db=drizzle(pg);await pg.exec(readFileSync(new URL('../drizzle/0060_background_activity.sql',import.meta.url),'utf8'))})
beforeEach(async()=>{process.env.BACKGROUND_ACTIVITY_GATE='1';await pg.exec('TRUNCATE app_activity,background_job_gate')})
afterAll(async()=>{delete process.env.BACKGROUND_ACTIVITY_GATE;await pg.close()})
it('runs each idle job once in fifteen minutes without fetching business data',async()=>{
 expect(await backgroundDue('alerts')).toBe(true);expect(await backgroundDue('alerts')).toBe(false);expect(await backgroundDue('demo')).toBe(true)
 await pg.exec(`UPDATE background_job_gate SET "ranAt"=now()-interval '16 minutes'`)
 expect(await backgroundDue('alerts')).toBe(true)
})
it('keeps visible authenticated usage active then expires it',async()=>{
 await recordAppActivity();expect((await backgroundActivityStatus()).active).toBe(true)
 expect(await backgroundDue('alerts')).toBe(true);expect(await backgroundDue('alerts')).toBe(true)
 await pg.exec(`UPDATE app_activity SET "seenAt"=now()-interval '6 minutes'`)
 expect((await backgroundActivityStatus()).active).toBe(false)
 expect(await backgroundDue('alerts')).toBe(true);expect(await backgroundDue('alerts')).toBe(false)
})
it('keeps legacy behavior when disabled',async()=>{delete process.env.BACKGROUND_ACTIVITY_GATE;expect(await backgroundDue('alerts')).toBe(true);expect(await backgroundDue('alerts')).toBe(true)})
