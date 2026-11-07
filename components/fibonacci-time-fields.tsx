"use client";
import { useId, useState, useRef } from "react";
import type { HistoricalTime, TimeBoundary } from "@/lib/fibonacci-time";
import { replaceEntryDate } from "@/lib/fibonacci-entry";
import { Field, FieldLabel, FieldDescription, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function BoundaryInput({label,value,onChange}:{label:string;value:TimeBoundary|null;onChange:(v:TimeBoundary|null)=>void}) {
  const id=useId();
  // Compare against the opening snapshot, not valid prefixes entered mid-typing.
  const originalBoundary=useRef(value);
  const [text,setText]=useState(value?.date ?? "");
  const [error,setError]=useState("");
  return <Field data-invalid={!!error}>
    <FieldLabel htmlFor={id}>{label}</FieldLabel>
    <Input id={id} value={text} placeholder="JJJJ, MM.JJJJ oder TT.MM.JJJJ" aria-invalid={!!error} aria-describedby={id+"hint"} onChange={event=>{
      const raw=event.target.value; setText(raw);
      try { const next=replaceEntryDate(originalBoundary.current,raw); event.target.setCustomValidity("");setError("");onChange(next); }
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

/** Month-level entry; older precise/uncertain boundaries remain editable without conversion. */
export function WaveMonthField({value,onChange}:{value:HistoricalTime;onChange:(v:HistoricalTime)=>void}) {
  const id=useId();
  const legacy=!!value.end || !!value.source || !!value.start && (value.start.precision !== "month" || !!value.start.approximate);
  if(legacy) return <details><summary className="cursor-pointer text-sm font-medium">Bisheriger historischer Zeitraum · Angaben vorhanden</summary><div className="mt-3"><HistoricalTimeFields value={value} onChange={onChange}/></div></details>;
  return <Field>
    <FieldLabel htmlFor={id}>Wellenbeginn · Monat und Jahr</FieldLabel>
    <Input id={id} type="month" min="0001-01" max="9999-12" value={value.start?.date ?? ""} onChange={event=>onChange({...value,start:event.target.value ? {date:event.target.value,precision:"month"} : null})}/>
    <FieldDescription>Monat und Jahr, in dem die Welle begonnen hat. Die Dauer wird separat in Tagen erfasst. Leer = unbekannt.</FieldDescription>
  </Field>;
}
