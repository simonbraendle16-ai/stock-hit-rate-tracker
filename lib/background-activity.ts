import {sql} from 'drizzle-orm'
import {db} from '@/lib/db'
/** Global conservative activity: any signed-in visible session keeps jobs active. */
export async function recordAppActivity(){
 if(process.env.BACKGROUND_ACTIVITY_GATE!=='1')return
 await db.execute(sql`INSERT INTO app_activity(id,"seenAt") VALUES(1,now()) ON CONFLICT(id) DO UPDATE SET "seenAt"=now() WHERE app_activity."seenAt"<now()-interval '1 minute'`)
}
export async function backgroundDue(job:string){
 if(process.env.BACKGROUND_ACTIVITY_GATE!=='1')return true
 return db.transaction(async tx=>{
 const active=await tx.execute(sql`SELECT id FROM app_activity WHERE id=1 AND "seenAt">now()-interval '5 minutes'`)
 if(active.rows.length)return true
 const claim=await tx.execute(sql`INSERT INTO background_job_gate(job,"ranAt") VALUES(${job},now()) ON CONFLICT(job) DO UPDATE SET "ranAt"=now() WHERE background_job_gate."ranAt"<=now()-interval '15 minutes' RETURNING job`)
 return claim.rows.length>0
 })
}
export async function backgroundActivityStatus(){
 if(process.env.BACKGROUND_ACTIVITY_GATE!=='1')return {enabled:false,active:true,intervalMinutes:0}
 const result=await db.execute(sql`SELECT "seenAt", "seenAt">now()-interval '5 minutes' AS active FROM app_activity WHERE id=1`)
 return {enabled:true,active:result.rows[0]?.active===true,intervalMinutes:15,lastActivity:result.rows[0]?.seenAt as string|undefined}
}
