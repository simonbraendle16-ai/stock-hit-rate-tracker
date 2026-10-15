export type ExecutionSession = { provider:'yahoo'; symbol:string; exchange:string; timezone:string; startMinute:number; endMinute:number; reportedAt:string; regularOnly:true }
export type SessionCandles<T> = T[] & { executionSession?:ExecutionSession;automaticProof?:{key:string;completedAt:string} }

/** A session comes from the same successful candle response, never from a
 * different market's clock or the mere fact that UTC midnight passed. */
export function reportedRegularSession(symbol:string,meta:{ exchangeTimezoneName?:string;exchangeName?:string;currentTradingPeriod?:{regular?:{start?:number;end?:number}} }|undefined):ExecutionSession|undefined {
  const start=meta?.currentTradingPeriod?.regular?.start,end=meta?.currentTradingPeriod?.regular?.end
  if(!meta?.exchangeTimezoneName||!meta.exchangeName||!start||!end||end<=start||end-start>12*3600)return
  try {
    const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:meta.exchangeTimezoneName,hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    const minutes=(n:number)=>{const p=Object.fromEntries(fmt.formatToParts(new Date(n*1000)).map(x=>[x.type,x.value]));return Number(p.hour)*60+Number(p.minute)}
    const a=minutes(start),b=minutes(end)
    if(b<=a)return
    return {provider:'yahoo',symbol,exchange:meta.exchangeName,timezone:meta.exchangeTimezoneName,startMinute:a,endMinute:b,reportedAt:new Date().toISOString(),regularOnly:true}
  }catch{return}
}
