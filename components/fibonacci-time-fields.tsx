"use client";
import { useId, useState } from "react";
import type { HistoricalTime, TimeBoundary } from "@/lib/fibonacci-time";
import { replaceEntryDate } from "@/lib/fibonacci-entry";
import { Field, FieldLabel, FieldDescription, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function BoundaryInput({label,value,onChange}:{label:string;value:TimeBoundary|null;onChange:(v:TimeBoundary|null)=>void}) {
  const id=useId();
  const [text,setText]=useState(value?.date ?? "");
  const [error,setError]=useState("");
  return <Field data-invalid={!!error}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input id={id} value={text} placeholder="JJJJ, MM.JJJJ oder TT.MM.JJJJ" aria-invalid={!!error} aria-describedby={id+"hint"} onChange={event=>{
      const raw=event.target.value; setText(raw);
      try { const next=replaceEntryDate(value,raw); event.target.setCustomValidity("");setError("");onChange(next); }
      catch { const message="Vollständiges Kalenderdatum eingeben: JJJJ, MM.JJJJ, TT.MM.JJJJ oder ISO-Datum.";event.target.setCustomValidity(message);setError(message); }
    }}/>
    <FieldDescription id={id+"hint"}>{error || (value?.approximate ? "Historische Ungefähr-Angabe bleibt erhalten. Eine Änderung des Datums ersetzt diese Grenze samt bisherigen Zusatzangaben." : "Jahr, Monat oder Tag wird automatisch erkannt. Leer = unbekannt.")}</FieldDescription>
  </Field>;
}

export function HistoricalTimeFields({value,onChange}:{value:HistoricalTime;onChange:(v:HistoricalTime)=>void}) {
  return <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <BoundaryInput label="Historischer Beginn" value={value.start} onChange={start=>onChange({...value,start})}/>
    <BoundaryInput label="Historisches Ende" value={value.end} onChange={end=>onChange({...value,end})}/>
  </FieldGroup>;
}
