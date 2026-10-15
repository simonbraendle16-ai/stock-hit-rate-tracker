import {beforeEach,describe,expect,it,vi} from 'vitest'
const state=vi.hoisted(()=>({onConnect:null as any,query:vi.fn()}))
vi.mock('pg',async original=>({...await original<typeof import('pg')>(),Pool:class{
  options={max:10}
  on(event:string,fn:unknown){if(event==='connect')state.onConnect=fn}
}}))
import {withDatabaseDeadline} from './db'

beforeEach(()=>state.query.mockReset().mockResolvedValue({rows:[]}))
describe('Aufrufbezogene Datenbankfrist',()=>{
  it('begrenzt nur den eigenen Zyklus und lässt Transaktionsbereinigung nach Fristablauf zu',async()=>{
    const client={query:state.query};state.onConnect(client)
    await client.query('SELECT outside')
    expect(state.query).toHaveBeenLastCalledWith('SELECT outside')
    await withDatabaseDeadline(Date.now()+10_000,async()=>{await client.query('SELECT bounded')})
    expect(state.query).toHaveBeenLastCalledWith({text:'SELECT bounded',query_timeout:4000})
    await withDatabaseDeadline(Date.now()-1,async()=>{
      expect(()=>client.query('UPDATE trade SET status=\'aktiv\'')).toThrow('Zeitbudget')
      await client.query('ROLLBACK')
    })
    expect(state.query).toHaveBeenLastCalledWith({text:'ROLLBACK',query_timeout:4000})
    await client.query('SELECT outside again')
    expect(state.query).toHaveBeenLastCalledWith('SELECT outside again')
  })
  it('erhält Parameter, Row-Modus und Typdecoder einer vorbereiteten Abfrage',async()=>{
    const client={query:state.query};state.onConnect(client)
    const config={text:'SELECT $1',rowMode:'array',types:{getTypeParser:()=>Number}},values=[1]
    await withDatabaseDeadline(Date.now()+10_000,async()=>{await client.query(config,values)})
    expect(state.query).toHaveBeenLastCalledWith({...config,query_timeout:4000},values)
  })
})
