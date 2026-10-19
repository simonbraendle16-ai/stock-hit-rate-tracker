import { readResearchQuery, type ResearchQuery } from './fibonacci-query-values';

export type ResearchView = {
  request: ResearchQuery;
  detail?: string;
  tab: string;
  error?: string;
};
export const researchTabs = ['protocol', 'distribution', 'context', 'data-groups', 'trades', 'history'];
export function defaultResearchView(stockId?: number): ResearchView {
  return { request: readResearchQuery(new URLSearchParams({measurementKind:'retracement', limit:'20', ...(stockId ? {stockId:String(stockId)} : {})})), tab:'protocol' };
}
export function readResearchLocation(params: URLSearchParams, stockId?: number): ResearchView {
  const defaults = defaultResearchView(stockId);
  const p = new URLSearchParams();
  for (const [k,v] of params) if (k.startsWith('fib.')) p.append(k.slice(4),v);
  const detail = p.get('detail') ?? undefined, tab = p.get('tab') ?? 'protocol';
  if (p.getAll('detail').length > 1 || p.getAll('tab').length > 1) throw Error('Doppelter Ansichtsparameter.');
  p.delete('detail'); p.delete('tab');
  if (p.has('allKinds') && (p.getAll('allKinds').length !== 1 || p.get('allKinds') !== '1')) throw Error('Ungültige Messartauswahl.');
  if (detail && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(detail)) throw Error('Ungültiger Detailverweis.');
  if (!researchTabs.includes(tab)) throw Error('Unbekannte Ergebnisansicht.');
  if (!p.has('limit')) p.set('limit','20');
  if (!p.has('measurementKind') && !params.has('fib.allKinds')) p.set('measurementKind','retracement');
  // allKinds is a UI marker, never an API filter.
  p.delete('allKinds');
  const request = readResearchQuery(p, false, true);
  if (request.limit !== 20 || request.offset % 20 !== 0) throw Error('Ungültige Tabellenseite.');
  if (stockId && request.filters.stockId && stockId !== request.filters.stockId) throw Error('Instrumentfilter widerspricht dieser Instrumentseite.');
  if (stockId) request.filters.stockId = stockId;
  return { ...defaults, request, detail, tab };
}
export function writeResearchLocation(params: URLSearchParams, view: ResearchView) {
  const out = new URLSearchParams(params);
  for (const k of [...out.keys()]) if (k.startsWith('fib.')) out.delete(k);
  const {request:r} = view;
  for (const [k,v] of Object.entries(r.filters)) if (v !== undefined && v !== '') out.set('fib.'+k,String(v));
  if (!r.filters.measurementKind) out.set('fib.allKinds','1');
  if (r.search) out.set('fib.search',r.search);
  if (r.query) out.set('fib.query',r.query);
  if (Object.keys(r.resolutions).length) out.set('fib.resolutions',JSON.stringify(r.resolutions));
  out.set('fib.selection',r.selection); out.set('fib.order',r.order);
  out.set('fib.offset',String(r.offset)); out.set('fib.limit',String(r.limit));
  out.set('fib.tab',view.tab);
  if (view.detail) out.set('fib.detail',view.detail);
  return out;
}
