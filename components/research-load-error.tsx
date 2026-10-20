'use client';
import { ResearchPanorama } from '@/components/research-panorama';
import { Button } from '@/components/ui/button';

/** Route data errors must never be displayed as an empty successful selection. */
export default function ResearchLoadError() {
  return <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
    <ResearchPanorama groups={[]} state="error" error="Die Daten konnten nicht geladen werden. Deine Suchadresse bleibt erhalten. Bitte erneut versuchen." />
    <Button onClick={()=>window.location.reload()}>Erneut laden</Button>
  </div>;
}
