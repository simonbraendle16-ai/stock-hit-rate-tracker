"use client";
import { useId } from "react";
import { CatalogueChoice, ZoneChoice } from "@/components/fibonacci-categorical-inputs";
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldSet, FieldLegend } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { residenceKindLabels, reversalLabel, type TargetZoneReversal } from "@/lib/fibonacci-residence";
import { ZONE_TO_PIVOT, CALENDAR_TIME_NOTE, durationDefinitions } from "@/lib/fibonacci-duration-definitions";

export function ReversalEditor({value,zone,onChange}: {value?:TargetZoneReversal|null;zone?:[number,number]|null;onChange:(v:TargetZoneReversal|null)=>void}) {
  const id=useId();
  const base:TargetZoneReversal=value ?? {kind:"unknown",unit:"hour",timeBasis:"calendar",measurementConvention:ZONE_TO_PIVOT,zone:zone ? [...zone] : [NaN,NaN],originalText:null};
  const set=(v:Partial<TargetZoneReversal>)=>onChange({...base,...v,timeBasis:"calendar",measurementConvention:ZONE_TO_PIVOT});
  const numeric=(key:"value"|"lower"|"upper",label:string)=><Field key={key}><FieldLabel htmlFor={id+key}>{label}</FieldLabel><Input id={id+key} type="number" min="0" step="any" value={Number.isFinite(base[key]) ? base[key] : ""} onChange={e=>set({[key]:e.target.value === "" ? undefined : Number(e.target.value)})}/></Field>;
  return <FieldSet className="min-w-0"><FieldLegend>{durationDefinitions.reversal.label} · Dauerangabe</FieldLegend>
    <FieldDescription>{durationDefinitions.reversal.description} {CALENDAR_TIME_NOTE}</FieldDescription>
    <CatalogueChoice label="Angabe bis zum Wellenwendepunkt" value={value?.kind ?? "none"} options={[["none","Nicht erhoben"],...Object.entries(residenceKindLabels)]} onChange={v=>{
      if(v === "none") return onChange(null);
      const {value:_,lower:__,upper:___,lowerInclusive:____,upperInclusive:_____,...rest}=base;
      onChange({...rest,kind:v as TargetZoneReversal["kind"],...(v === "range" ? {lowerInclusive:true,upperInclusive:true} : v === "upper_bound" ? {upperInclusive:false} : {})});
    }}/>
    {value && <FieldGroup>
      {(value.kind === "exact" || value.kind === "approximate") && numeric("value","Dauer bis zum Wellenwendepunkt")}
      {value.kind === "range" && numeric("lower","Wendepunktdauer von")}
      {(value.kind === "range" || value.kind === "upper_bound") && numeric("upper","Wendepunktdauer bis")}
      {value.kind === "range" && <CatalogueChoice label="Untere Grenze der Wendepunktdauer" value={String(value.lowerInclusive)} options={[["true","Ab einschließlich"],["false","Mehr als"]]} onChange={v=>set({lowerInclusive:v === "true"})}/>}
      {(value.kind === "range" || value.kind === "upper_bound") && <CatalogueChoice label="Obere Grenze der Wendepunktdauer" value={String(value.upperInclusive)} options={[["false","Unter (strikt kleiner)"],["true","Bis einschließlich"]]} onChange={v=>set({upperInclusive:v === "true"})}/>}
      {value.kind !== "unknown" && <CatalogueChoice label="Einheit der Wendepunktdauer" value={value.unit} options={[["minute","Minuten"],["hour","Stunden"],["day","Tage"]]} onChange={v=>set({unit:v as TargetZoneReversal["unit"]})}/>}
      <ZoneChoice label="Zielzone des ersten Kontakts · Wendepunktdauer" value={Number.isFinite(value.zone[0]) ? value.zone : null} onChange={v=>set({zone:v ?? [NaN,NaN]})}/>
      <FieldDescription>Der Zonenbezug bleibt bei späteren Änderungen der erwarteten Zone erhalten. Ein Wendepunkt unmittelbar beim ersten Kontakt darf ausdrücklich als 0 erfasst werden; unbekannt bleibt unbekannt.</FieldDescription>
      <Field><FieldLabel htmlFor={id+"text"}>Ursprüngliche Angabe zur Wendepunktdauer (optional)</FieldLabel><Input id={id+"text"} maxLength={2000} value={value.originalText ?? ""} onChange={e=>set({originalText:e.target.value || null})}/></Field>
      <p className="text-sm" aria-live="polite">{reversalLabel(value)}</p>
    </FieldGroup>}
  </FieldSet>;
}
