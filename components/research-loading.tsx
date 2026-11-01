import {CockpitFrame} from '@/components/cockpit-frame'
import {ResearchPanorama} from '@/components/research-panorama'
export function ResearchLoading(){return <div className="min-h-svh"><CockpitFrame account={<span role="status" className="text-sm text-muted-foreground">Arbeitsbereich wird geladen …</span>}/><main id="cockpit-content" tabIndex={-1} aria-busy="true" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8"><ResearchPanorama groups={[]} state="loading"/></main></div>}
