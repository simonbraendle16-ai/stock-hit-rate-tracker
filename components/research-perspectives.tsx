'use client'

import type { ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { type ResearchPerspective } from '@/lib/fibonacci-location'

const perspectives = [
  {value:'panorama',label:'Panorama',title:'Die Auswahl im Überblick',description:'Datenbasis und zusammengefasste Beobachtungen deiner Untersuchung.'},
  {value:'studio',label:'Statistikstudio',title:'Verteilungen genauer untersuchen',description:'Level, Zielzonen, Muster und Unterteilung anhand derselben Auswahl prüfen.'},
  {value:'structure',label:'Strukturvergleich',title:'Wellen und Strukturen vergleichen',description:'Vergleichbare Wellenkontexte und ihre dokumentierten Merkmale untersuchen.'},
] as const

export function ResearchPerspectives({value,onChange,children}: {value:ResearchPerspective;onChange:(value:ResearchPerspective)=>void;children:ReactNode}) {
  const active=perspectives.find(p=>p.value===value)!
  return <Tabs value={value} onValueChange={v=>onChange(v as ResearchPerspective)} className="min-w-0 gap-6">
    <div className="research-perspectives">
      <TabsList variant="line" aria-label="Forschungsperspektiven" activateOnFocus className="min-h-12 min-w-max gap-3">
        {perspectives.map(p=><TabsTrigger key={p.value} value={p.value} className="min-h-11 px-4">{p.label}</TabsTrigger>)}
      </TabsList>
    </div>
    <TabsContent value={value} className="min-w-0 flex flex-col gap-5" data-perspective={value}>
      <div><h3 className="text-2xl font-semibold tracking-tight">{active.title}</h3><p className="mt-2 text-sm text-muted-foreground">{active.description}</p></div>
      {children}
    </TabsContent>
  </Tabs>
}
