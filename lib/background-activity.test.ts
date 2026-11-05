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

it('uses one statement and no explicit transaction for a due check',async()=>{
 const execute=vi.spyOn(state.db,'execute');const transaction=vi.spyOn(state.db,'transaction');
 try{expect(await backgroundDue('alerts')).toBe(true);expect(execute).toHaveBeenCalledTimes(1);expect(transaction).not.toHaveBeenCalled()}finally{execute.mockRestore();transaction.mockRestore()}
})
it('keeps an active check from consuming the later idle claim',async()=>{
 await recordAppActivity();expect(await backgroundDue('alerts')).toBe(true);
 expect((await pg.query('SELECT * FROM background_job_gate')).rows).toHaveLength(0);
 await pg.exec(`UPDATE app_activity SET "seenAt"=now()-interval '6 minutes'`);
 expect(await backgroundDue('alerts')).toBe(true);expect(await backgroundDue('alerts')).toBe(false)
})
it('propagates database failure instead of admitting unverified work',async()=>{
 const execute=vi.spyOn(state.db,'execute').mockRejectedValueOnce(new Error('synthetic unavailable'));
 try{await expect(backgroundDue('alerts')).rejects.toThrow('synthetic unavailable')}finally{execute.mockRestore()}
})

it('returns recorded activity status in one statement without rewriting a recent heartbeat',async()=>{
 const execute=vi.spyOn(state.db,'execute');
 try{const first=await recordAppActivity();expect(first).toMatchObject({enabled:true,active:true,intervalMinutes:15});expect(execute).toHaveBeenCalledTimes(1);
 const second=await recordAppActivity();expect(second.lastActivity).toEqual(first.lastActivity);expect(execute).toHaveBeenCalledTimes(2)
 }finally{execute.mockRestore()}
})

it('admits just one repeated idle claim and keeps different jobs independent',async()=>{
 const results=await Promise.all([backgroundDue('alerts'),backgroundDue('alerts'),backgroundDue('demo')]);
 expect(results).toEqual([true,false,true]);
})
it('does not touch the database when disabled and returns legacy activity status',async()=>{
 delete process.env.BACKGROUND_ACTIVITY_GATE;const execute=vi.spyOn(state.db,'execute');
 try{expect(await recordAppActivity()).toEqual({enabled:false,active:true,intervalMinutes:0});expect(await backgroundDue('alerts')).toBe(true);expect(execute).not.toHaveBeenCalled()}finally{execute.mockRestore()}
})

it('refreshes an expired heartbeat and returns the stored timestamp',async()=>{
 await recordAppActivity();await pg.exec(`UPDATE app_activity SET "seenAt"=now()-interval '6 minutes'`);
 const status=await recordAppActivity();expect(status.active).toBe(true);
 const stored=await backgroundActivityStatus();expect(stored.active).toBe(true);expect(status.lastActivity).toEqual(stored.lastActivity);
})
