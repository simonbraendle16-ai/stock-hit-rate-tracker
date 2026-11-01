'use client';
import { ResearchPanorama } from '@/components/research-panorama';
import { CockpitFrame } from '@/components/cockpit-frame';
import { Button } from '@/components/ui/button';

/** Route data errors must never be displayed as an empty successful selection. */
export default function ResearchLoadError() {
  return <div className="min-h-svh"><CockpitFrame account={<span className="text-sm text-muted-foreground">Daten nicht verfügbar</span>} /><main id="cockpit-content" tabIndex={-1} className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 sm:py-8">
    <ResearchPanorama groups={[]} state="error" error="Die Daten konnten nicht geladen werden. Deine Suchadresse bleibt erhalten. Bitte erneut versuchen." />
    <Button onClick={()=>window.location.reload()}>Erneut laden</Button>
  </main></div>;
}
