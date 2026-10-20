import { describe, expect, it } from 'vitest';
import { readResearchQuery } from './fibonacci-query-values';
import { defaultResearchView, readResearchLocation, writeResearchLocation, changeResearchPerspective, resetResearchView, updateResearchRequest, researchPerspectives, researchHistoryState } from './fibonacci-location';

describe('research presentation and selection contract',()=>{
  it('lets Next synchronize external URLs while retaining framework tree and custom scroll state',()=>{
    const state={__NA:true,_N:true,__PRIVATE_NEXTJS_INTERNALS_TREE:{tree:'unchanged'},fibReturnScroll:{x:0,y:1700},other:'keep'};
    const next=researchHistoryState(state,{fibDetailEntry:false});
    expect(next).not.toHaveProperty('__NA');expect(next).not.toHaveProperty('_N');
    expect(next).toMatchObject({__PRIVATE_NEXTJS_INTERNALS_TREE:state.__PRIVATE_NEXTJS_INTERNALS_TREE,fibReturnScroll:{x:0,y:1700},other:'keep',fibDetailEntry:false});
    expect(state.__NA).toBe(true);expect(researchHistoryState(null)).toEqual({});
  });
  it('opens old links in Panorama without cases and preserves the existing fachlicher tab',()=>{
    const view=readResearchLocation(new URLSearchParams('fib.tab=history&other=keep'));
    expect(view).toMatchObject({perspective:'panorama',basisOpen:false,tab:'history'});
  });
  it.each(researchPerspectives)('roundtrips %s, open basis, detail, pagination and foreign parameters',perspective=>{
    const view={...defaultResearchView(),perspective,basisOpen:true,detail:'10000000-0000-4000-8000-000000000001',tab:'context'};
    view.request.offset=20;view.request.order='oldest';view.request.query='Tesla Welle 4';
    view.request.resolutions={waveLabelScope:'self'};
    const encoded=writeResearchLocation(new URLSearchParams('other=keep&fib.obsolete=yes'),view);
    expect(encoded.get('other')).toBe('keep');expect(encoded.has('fib.obsolete')).toBe(false);
    expect(readResearchLocation(encoded)).toEqual(view);
    expect(readResearchLocation(encoded).request.filters).not.toHaveProperty('perspective');
  });
  it.each(['fib.perspective=unknown','fib.perspective=','fib.perspective=studio&fib.perspective=panorama','fib.basis=0','fib.basis=','fib.basis=1&fib.basis=1'])('rejects malformed UI state: %s',query=>{
    expect(()=>readResearchLocation(new URLSearchParams(query))).toThrow();
  });
  it('keeps UI keys outside the strict API query contract',()=>{
    expect(()=>readResearchQuery(new URLSearchParams('perspective=studio'))).toThrow();
    expect(()=>readResearchQuery(new URLSearchParams('basis=1'))).toThrow();
  });
  it('switches presentation without replacing or mutating the shared request',()=>{
    const view={...defaultResearchView(),basisOpen:true,detail:'10000000-0000-4000-8000-000000000001'};
    view.request.query='Tesla Welle 4';view.request.offset=20;view.request.filters={wave:'4',waveLabelScope:'self',measurementKind:'expansion'};
    const next=changeResearchPerspective(view,'structure');
    expect(next.request).toBe(view.request);expect(next).toMatchObject({perspective:'structure',basisOpen:false,detail:undefined});
    expect(view.basisOpen).toBe(true);expect(view.detail).toBeDefined();
  });
  it('closes cases and resets only the page on a selection edit, preserving perspective',()=>{
    const view={...defaultResearchView(),perspective:'studio' as const,basisOpen:true,detail:'10000000-0000-4000-8000-000000000001'};
    view.request.offset=40;view.request.order='oldest';
    const next=updateResearchRequest(view,'search','source');
    expect(next).toMatchObject({perspective:'studio',basisOpen:false,detail:undefined,request:{search:'source',offset:0,order:'oldest'}});
    expect(updateResearchRequest(view,'offset',20)).toMatchObject({basisOpen:true,request:{offset:20}});
    expect(updateResearchRequest(view,'order','deepest')).toMatchObject({basisOpen:true,request:{order:'deepest'}});
  });
  it('reset preserves the current perspective and fixed instrument while clearing selection/detail',()=>{
    const view={...defaultResearchView(),perspective:'structure' as const,basisOpen:true,detail:'10000000-0000-4000-8000-000000000001'};
    view.request.query='Tesla';view.request.offset=20;
    const next=resetResearchView(view,3);
    expect(next).toMatchObject({perspective:'structure',basisOpen:false,request:{query:'',offset:0,filters:{stockId:3}}});
    expect(next.detail).toBeUndefined();
    expect(writeResearchLocation(new URLSearchParams(),next).has('fib.basis')).toBe(false);
  });
});
