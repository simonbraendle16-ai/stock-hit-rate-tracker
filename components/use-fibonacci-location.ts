"use client";
import { useEffect, useRef, useState } from 'react';
import { changeResearchPerspective, defaultResearchView, readResearchLocation, researchHistoryState, writeResearchLocation, type ResearchPerspective } from '@/lib/fibonacci-location';

/** Namespaced URL state leaves other page features and the fragment intact. */
export function useFibonacciLocation(stockId?: number) {
  const [view,setView] = useState(()=>defaultResearchView(stockId));
  const [loaded,setLoaded] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const returnScroll = useRef<{x:number;y:number} | null>(null);
  useEffect(()=>{
    const restore = ()=>{
      const saved = window.history.state?.fibReturnScroll;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) returnScroll.current=saved;
      try { setView(readResearchLocation(new URLSearchParams(window.location.search),stockId)); }
      catch(e) { setView({...defaultResearchView(stockId), error:e instanceof Error ? e.message : 'Ungültige Suchadresse.'}); }
      setLoaded(true);
    };
    restore();
    window.addEventListener('popstate',restore);
    return ()=>window.removeEventListener('popstate',restore);
  },[stockId]);
  useEffect(()=>{
    if (!loaded || view.error) return;
    const url = new URL(window.location.href);
    url.search = writeResearchLocation(url.searchParams,view).toString();
    if (url.href !== window.location.href) window.history.replaceState(researchHistoryState(window.history.state),'',url);
  },[view,loaded]);
  const detail = (id?: string, trigger?: HTMLElement)=>{
    if (!id && view.detail && window.history.state?.fibDetailEntry) { window.history.back(); return; }
    setView(v=>({...v,detail:id}));
    if (id) {
      returnFocus.current=trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      returnScroll.current={x:window.scrollX,y:window.scrollY};
      const historyState=researchHistoryState(window.history.state,{fibReturnScroll:returnScroll.current});
      window.history.replaceState(historyState,'',window.location.href);
      const url = new URL(window.location.href);
      url.search = writeResearchLocation(url.searchParams,{...view,detail:id}).toString();
      window.history.pushState({...historyState,fibDetailEntry:true},'',url);
    }
  };
  const perspective = (next: ResearchPerspective)=>{
    if (next === view.perspective) return;
    const nextView = changeResearchPerspective(view,next);
    const url = new URL(window.location.href);
    url.search = writeResearchLocation(url.searchParams,nextView).toString();
    // Next's wrapper copies its own internals; retain custom return-state fields.
    window.history.pushState(researchHistoryState(window.history.state,{fibDetailEntry:false}),'',url);
    setView(nextView);
  };
  const restoreDetailFocus = ()=>{
    returnFocus.current?.focus({preventScroll:true});
    const position=returnScroll.current;
    // Popstate and dialog focus restoration both finish before the final scroll restoration.
    if (position) window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>window.scrollTo(position.x,position.y)));
    return false;
  };
  return {view,setView,loaded,detail,restoreDetailFocus,perspective};
}
