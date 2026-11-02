import type { FibObservation } from './fibonacci'
export type CollectionItem = Pick<FibObservation,'id'|'version'|'stockId'|'ticker'|'name'|'market'|'wave'|'degree'|'timeframe'|'status'|'observedOn'|'measurementKind'|'percent'> & {createdAt:Date}
export type CollectionPage = {items:CollectionItem[];total:number;retracements:number;expansions:number;matched:number;offset:number}
