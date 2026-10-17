import {afterEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({refresh:vi.fn(),cleanup:undefined as undefined|(()=>void)}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:state.refresh})}));
vi.mock('react',()=>({useEffect:(effect:()=>()=>void)=>{state.cleanup=effect();}}));
import {AnalysisAutoRefresh} from '../components/analysis-auto-refresh';
afterEach(()=>{state.cleanup?.();vi.useRealTimers();vi.unstubAllGlobals();vi.clearAllMocks();});
it('refreshes external writes on focus and each visible minute; hidden tabs and unmounted pages do not poll',()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
 const doc=new EventTarget() as EventTarget & {visibilityState:string};doc.visibilityState='visible';
 const win=new EventTarget();vi.stubGlobal('document',doc);vi.stubGlobal('window',win);
 AnalysisAutoRefresh();vi.advanceTimersByTime(60000);expect(state.refresh).toHaveBeenCalledTimes(1);
 doc.visibilityState='hidden';vi.advanceTimersByTime(60000);expect(state.refresh).toHaveBeenCalledTimes(1);
 doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));win.dispatchEvent(new Event('focus'));expect(state.refresh).toHaveBeenCalledTimes(2);
 vi.advanceTimersByTime(1001);win.dispatchEvent(new Event('focus'));expect(state.refresh).toHaveBeenCalledTimes(3);
 state.cleanup?.();vi.advanceTimersByTime(60000);win.dispatchEvent(new Event('focus'));expect(state.refresh).toHaveBeenCalledTimes(3);
});
