"use client";
import { useId } from "react";
import type { HistoricalTime, TimeBoundary } from "@/lib/fibonacci-time";
import { Field, FieldLabel, FieldDescription, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CatalogueChoice } from "./fibonacci-categorical-inputs";

export function HistoricalTimeFields({value,onChange}:{value:HistoricalTime;onChange:(v:HistoricalTime)=>void}) {
  const prefix = useId();
  return <FieldGroup>
    <FieldDescription>Historische Wellenzeit: Tag, Monat oder Jahr. Leere Grenze bedeutet unbekannt. Ungefähre Angaben erhalten ohne belegte Grenzen keine erfundene Toleranz.</FieldDescription>
    {(["start","end"] as const).map(key=>{
      const b = value[key];
      const set = (patch: Partial<TimeBoundary>) => onChange({...value,[key]:{precision:b?.precision ?? "day",date:b?.date ?? "",...b,...patch}});
      return <FieldGroup key={key} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field><FieldLabel htmlFor={prefix+key}>{key === "start" ? "Historischer Beginn" : "Historisches Ende"}</FieldLabel><Input id={prefix+key} placeholder="2008 / 2008-03 / 2008-03-12" value={b?.date ?? ""} onChange={e=>{const date=e.target.value;onChange({...value,[key]:date ? {...b,date,precision:date.length===4?"year":date.length===7?"month":"day"} : null});}}/></Field>
        <CatalogueChoice label={key === "start" ? "Genauigkeit Beginn" : "Genauigkeit Ende"} value={b?.approximate ? "approximate" : "documented"} options={[["documented","Wie angegeben (Tag/Monat/Jahr)"],["approximate","Ungefähr"]]} onChange={v=>{if(b)onChange({...value,[key]:{precision:b.precision,date:b.date,approximate:v === "approximate"}});}}/>
        {b?.approximate && <>{(["earliest","latest"] as const).map(bound=><Field key={bound}><FieldLabel htmlFor={prefix+key+bound}>{key === "start" ? "Beginn" : "Ende"}: {bound === "earliest" ? "frühestens" : "spätestens"} · optional</FieldLabel><Input type="date" id={prefix+key+bound} value={b[bound] ?? ""} onChange={e=>set({[bound]:e.target.value || undefined})}/></Field>)}</>}
      </FieldGroup>;
    })}
  </FieldGroup>;
}
