import {afterEach,it,expect,vi} from 'vitest'
const state=vi.hoisted(()=>({check:vi.fn(async()=>[]),refresh:vi.fn(),cleanup:undefined as undefined|(()=>void)}))
vi.mock('react',()=>({useRef:()=>({current:false}),useEffect:(effect:()=>()=>void)=>{state.cleanup=effect()}}))
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:state.refresh})}))
vi.mock('@/app/actions/alerts',()=>({checkAlerts:state.check}))
vi.mock('sonner',()=>({toast:{warning:vi.fn()}}))
import {AlertWatcher} from '@/components/alert-watcher'
afterEach(()=>{state.cleanup?.();vi.useRealTimers();vi.unstubAllGlobals();vi.clearAllMocks()})
it('does not poll a hidden cockpit and resumes once when visible',async()=>{
 vi.useFakeTimers();const doc=Object.assign(new EventTarget(),{visibilityState:'hidden'});vi.stubGlobal('document',doc)
 AlertWatcher();await vi.advanceTimersByTimeAsync(15*60000);expect(state.check).not.toHaveBeenCalled()
 doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(0);expect(state.check).toHaveBeenCalledTimes(1)
 await vi.advanceTimersByTimeAsync(5*60000);expect(state.check).toHaveBeenCalledTimes(2)
 doc.visibilityState='hidden';await vi.advanceTimersByTimeAsync(15*60000);expect(state.check).toHaveBeenCalledTimes(2)
 state.cleanup?.();await vi.advanceTimersByTimeAsync(15*60000);expect(state.check).toHaveBeenCalledTimes(2)
})
