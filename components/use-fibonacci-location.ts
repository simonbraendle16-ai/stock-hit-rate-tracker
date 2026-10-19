"use client";
import { useEffect, useRef, useState } from 'react';
import { defaultResearchView, readResearchLocation, writeResearchLocation, type ResearchView } from '@/lib/fibonacci-location';

/** Namespaced URL state leaves other page features and the fragment intact. */
export function useFibonacciLocation(stockId?: number) {
  const [view,setView] = useState(()=>defaultResearchView(stockId));
  const [loaded,setLoaded] = useState(false);
  const pushedDetail = useRef(false);
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
    if (url.href !== window.location.href) window.history.replaceState(window.history.state,'',url);
  },[view,loaded]);
  const detail = (id?: string, trigger?: HTMLElement)=>{
    if (!id && pushedDetail.current) { pushedDetail.current=false; window.history.back(); return; }
    setView(v=>({...v,detail:id}));
    if (id) {
      returnFocus.current=trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      returnScroll.current={x:window.scrollX,y:window.scrollY};
      const historyState={...window.history.state,fibReturnScroll:returnScroll.current};
      window.history.replaceState(historyState,'',window.location.href);
      const url = new URL(window.location.href);
      url.search = writeResearchLocation(url.searchParams,{...view,detail:id}).toString();
      window.history.pushState(historyState,'',url);
      pushedDetail.current=true;
    }
  };
  const restoreDetailFocus = ()=>{
    returnFocus.current?.focus({preventScroll:true});
    const position=returnScroll.current;
    // Popstate and dialog focus restoration both finish before the final scroll restoration.
    if (position) window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>window.scrollTo(position.x,position.y)));
    return false;
  };
  return {view,setView,loaded,detail,restoreDetailFocus};
}
