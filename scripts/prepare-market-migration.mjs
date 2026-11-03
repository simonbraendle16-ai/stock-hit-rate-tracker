// Deliberately local-only in Phase 3. No implicit env loader, cloud DDL or cutover.
import { Client } from 'pg'
import { readFileSync } from 'node:fs'
import { copyMarketPackages,setMarketWritable } from './market-migration.mjs'
const args=process.argv.slice(2)
if(args.length!==2||!['schema','copy','rollback','resume'].includes(args[0])||!/^--id=[A-Za-z0-9_-]{1,60}$/.test(args[1]))throw new Error('schema|copy|resume|rollback --id=KENNUNG erforderlich; nur isoliert.')
function isolated(value){let u;try{u=new URL(value||'')}catch{throw new Error('Ungültiges isoliertes Datenbankziel.')} if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||!['postgres:','postgresql:'].includes(u.protocol))throw new Error('Phase-3-Werkzeug erlaubt ausschließlich lokale isolierte Datenbanken.');return value}
const aUrl=isolated(process.env.ISOLATED_CORE_DATABASE_URL),bUrl=isolated(process.env.ISOLATED_MARKET_DATABASE_URL)
const aIdentity=new URL(aUrl),bIdentity=new URL(bUrl)
if((aIdentity.port||'5432')===(bIdentity.port||'5432')&&aIdentity.pathname===bIdentity.pathname)throw new Error('Zwei getrennte Datenbanken erforderlich.')
const a=new Client({connectionString:aUrl,connectionTimeoutMillis:2000,statement_timeout:60000}),b=new Client({connectionString:bUrl,connectionTimeoutMillis:2000,statement_timeout:60000})
try{await a.connect();await b.connect()
 if(args[0]==='schema'){
  for(const [client,files] of [[a,['drizzle-market-core/0001_control.sql']],[b,['drizzle-market/0001_market.sql','drizzle-market/0002_control.sql']]])
   for(const file of files)await client.query(readFileSync(new URL('../'+file,import.meta.url),'utf8'))
  console.log('Getrennte lokale Schemata vorbereitet; keine Umschaltung.')
 }else{
  for(const client of [a,b]){const r=await client.query('SELECT writable FROM market_data_control WHERE id=1');if(r.rows[0]?.writable)await setMarketWritable(client,false)}
  console.log(JSON.stringify(await copyMarketPackages(args[0]==='rollback'?b:a,args[0]==='rollback'?a:b,args[1].slice(5)+(args[0]==='rollback'?'-reverse':''))))
  console.log('Beide Marktziele bleiben gesperrt. Keine Konfiguration umgestellt. Freigabe separat nach Abnahme.')
 }
}finally{await Promise.allSettled([a.end(),b.end()])}
