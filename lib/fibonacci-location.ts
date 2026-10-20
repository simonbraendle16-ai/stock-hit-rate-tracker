import { readResearchQuery, type ResearchQuery } from './fibonacci-query-values';

export type ResearchView = {
  request: ResearchQuery;
  perspective: ResearchPerspective;
  basisOpen: boolean;
  detail?: string;
  tab: string;
  error?: string;
};
export const researchPerspectives = ['panorama', 'studio', 'structure'] as const;
export type ResearchPerspective = typeof researchPerspectives[number];
export const researchTabs = ['protocol', 'distribution', 'context', 'data-groups', 'trades', 'history'];
export function defaultResearchView(stockId?: number): ResearchView {
  return { request: readResearchQuery(new URLSearchParams({measurementKind:'retracement', limit:'20', ...(stockId ? {stockId:String(stockId)} : {})})), tab:'protocol', perspective:'panorama', basisOpen:false };
}
export function readResearchLocation(params: URLSearchParams, stockId?: number): ResearchView {
  const defaults = defaultResearchView(stockId);
  const p = new URLSearchParams();
  for (const [k,v] of params) if (k.startsWith('fib.')) p.append(k.slice(4),v);
  const detail = p.get('detail') ?? undefined, tab = p.get('tab') ?? 'protocol';
  const perspective = p.get('perspective') ?? 'panorama';
  const basis = p.get('basis');
  if (['detail','tab','perspective','basis'].some(key=>p.getAll(key).length > 1)) throw Error('Doppelter Ansichtsparameter.');
  if (!researchPerspectives.includes(perspective as ResearchPerspective)) throw Error('Unbekannte Forschungsperspektive.');
  if (basis !== null && basis !== '1') throw Error('Ungültige Datengrundlagenansicht.');
  p.delete('detail'); p.delete('tab'); p.delete('perspective'); p.delete('basis');
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
  return { ...defaults, request, detail, tab, perspective:perspective as ResearchPerspective, basisOpen:basis === '1' };
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
  out.set('fib.perspective',view.perspective);
  if (view.basisOpen) out.set('fib.basis','1');
  if (view.detail) out.set('fib.detail',view.detail);
  return out;
}

/** Selection edits dismiss cases; table ordering/pagination keep a conscious opening. */
export function updateResearchRequest<K extends keyof ResearchQuery>(view: ResearchView, key: K, value: ResearchQuery[K]): ResearchView {
  const selectionChange = !['offset','limit','order'].includes(key);
  return {...view, request:{...view.request,[key]:value,...(selectionChange ? {offset:0} : {})},
    ...(selectionChange ? {basisOpen:false,detail:undefined} : {})};
}
export function changeResearchPerspective(view: ResearchView, perspective: ResearchPerspective): ResearchView {
  return {...view,perspective,basisOpen:false,detail:undefined};
}
export function resetResearchView(view: ResearchView, stockId?: number): ResearchView {
  return {...defaultResearchView(stockId),perspective:view.perspective};
}

/** Let Next's public history wrapper synchronize its canonical URL. Its internal
 * loop markers would skip that synchronization; the wrapper copies them back. */
export function researchHistoryState(state: Record<string, unknown> | null, patch: Record<string, unknown> = {}) {
  const result={...state,...patch};
  delete result.__NA;
  delete result._N;
  return result;
}
