import {describe,it,expect} from 'vitest'
import {workspaceIsActive} from './cockpit-navigation'
describe('workspace navigation',()=>{
  it.each([['/','/'],['/analysis','/analysis#fibonacci'],['/collection','/collection?fib.basis=1'],['/stock/12','/watchlist'],['/broker-orders','/trades'],['/trades/12/einstieg','/trades'],['/settings/assistant-api','/settings']])('maps %s to %s',(route,href)=>expect(workspaceIsActive(route,href)).toBe(true))
  it.each([['/trades-extra','/trades'],['/analysis','/forecasts'],['/collection','/analysis#fibonacci'],['/trades/12','/']])('does not activate unrelated %s / %s',(route,href)=>expect(workspaceIsActive(route,href)).toBe(false))
})
