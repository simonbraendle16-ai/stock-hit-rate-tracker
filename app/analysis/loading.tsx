import { ResearchPanorama } from '@/components/research-panorama';
export default function Loading() {
  return <div className="mx-auto max-w-3xl p-6"><ResearchPanorama groups={[]} state="loading" /></div>;
}
