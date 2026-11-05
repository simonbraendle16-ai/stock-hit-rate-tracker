import {sql} from 'drizzle-orm'
import {db} from '@/lib/db'
/** Global conservative activity: any signed-in visible session keeps jobs active. */
export async function recordAppActivity(){
 if(process.env.BACKGROUND_ACTIVITY_GATE!=='1')return {enabled:false,active:true,intervalMinutes:0}
 const result=await db.execute(sql`WITH recorded AS (
 INSERT INTO app_activity(id,"seenAt") VALUES(1,now())
 ON CONFLICT(id) DO UPDATE SET "seenAt"=now()
 WHERE app_activity."seenAt"<now()-interval '1 minute'
 RETURNING "seenAt"
 ) SELECT "seenAt" FROM recorded
 UNION ALL SELECT "seenAt" FROM app_activity WHERE id=1 AND NOT EXISTS(SELECT 1 FROM recorded)
 LIMIT 1`)
 // A concurrent first heartbeat can win outside this statement's snapshot.
 // Its conflict row is necessarily fresh; lastActivity remains optional.
 return {enabled:true,active:true,intervalMinutes:15,lastActivity:result.rows[0]?.seenAt as string|undefined}
}
export async function backgroundDue(job:string){
 if(process.env.BACKGROUND_ACTIVITY_GATE!=='1')return true
 // One statement/snapshot; the unique job key still serializes idle claims.
 const result=await db.execute(sql`WITH active AS MATERIALIZED (
 SELECT id FROM app_activity WHERE id=1 AND "seenAt">now()-interval '5 minutes'
 ), claim AS (
 INSERT INTO background_job_gate(job,"ranAt")
 SELECT ${job},now() WHERE NOT EXISTS(SELECT 1 FROM active)
 ON CONFLICT(job) DO UPDATE SET "ranAt"=now()
 WHERE background_job_gate."ranAt"<=now()-interval '15 minutes'
 RETURNING job
 ) SELECT EXISTS(SELECT 1 FROM active) OR EXISTS(SELECT 1 FROM claim) AS due`)
 return result.rows[0]?.due===true
}
export async function backgroundActivityStatus(){
 if(process.env.BACKGROUND_ACTIVITY_GATE!=='1')return {enabled:false,active:true,intervalMinutes:0}
 const result=await db.execute(sql`SELECT "seenAt", "seenAt">now()-interval '5 minutes' AS active FROM app_activity WHERE id=1`)
 return {enabled:true,active:result.rows[0]?.active===true,intervalMinutes:15,lastActivity:result.rows[0]?.seenAt as string|undefined}
}
