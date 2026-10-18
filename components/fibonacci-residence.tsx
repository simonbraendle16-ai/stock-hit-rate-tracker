"use client";
import { useId } from "react";
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldSet, FieldLegend } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from "@/components/ui/select";
import { residenceKindLabels, residenceLabel, type TargetZoneResidence } from "@/lib/fibonacci-residence";

function Choice({id, label, value, options, onChange}: {id: string; label: string; value: string; options: [string,string][]; onChange: (v: string)=>void}) {
  return <Field><FieldLabel htmlFor={id}>{label}</FieldLabel><Select items={options.map(([value,label])=>({value,label}))} value={value} onValueChange={v=>{if(v !== null) onChange(v);}}><SelectTrigger id={id}><SelectValue/></SelectTrigger><SelectContent><SelectGroup>{options.map(([v,l])=><SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>;
}

export function ResidenceEditor({value, zone, onChange}: {value?: TargetZoneResidence | null; zone: [number,number] | null; onChange: (v: TargetZoneResidence | null)=>void}) {
  const id = useId();
  const base: TargetZoneResidence = value ?? {kind:"unknown", touchAndGo:null, unit:"day", timeBasis:"unknown", measurementConvention:null, zone:zone ? [...zone] : [NaN,NaN], originalText:null};
  const set = (change: Partial<TargetZoneResidence>) => onChange({...base,...change});
  const behavior = !value ? "not_recorded" : value.touchAndGo === true ? "touch" : value.touchAndGo === false ? "residence" : "unknown";
  const numeric = (key: "value" | "lower" | "upper", label: string) => <Field key={key}><FieldLabel htmlFor={id+key}>{label}</FieldLabel><Input id={id+key} type="number" min="0" step="any" value={Number.isFinite(base[key]) ? base[key] : ""} onChange={e=>set({[key]:e.target.value === "" ? undefined : Number(e.target.value)})}/></Field>;
  function changeKind(kind: TargetZoneResidence["kind"]) {
    if (kind === base.kind) return;
    const {value:_, lower:__, upper:___, lowerInclusive:____, upperInclusive:_____, ...rest} = base;
    onChange({...rest,kind,...(kind === "range" ? {lowerInclusive:true,upperInclusive:true} : kind === "upper_bound" ? {upperInclusive:false} : {})});
  }
  return <FieldSet><FieldLegend>Verweildauer in der Zielzone</FieldLegend>
    <FieldDescription>Was hat der Kurs in der Zone gemacht? Touch-and-Go ist eine qualitative Angabe. Eine bekannte Dauer oder Grenze kannst du zusätzlich eintragen.</FieldDescription>
    <Choice id={id+"behavior"} label="Verhalten in der Zielzone" value={behavior} options={[["not_recorded","Nicht erhoben"],["touch","Touch-and-Go"],["residence","Länger verweilt"],["unknown","Unbekannt"]]} onChange={v=>v === "not_recorded" ? onChange(null) : set({touchAndGo:v === "touch" ? true : v === "residence" ? false : null})}/>
    {value && <FieldGroup>
      <Choice id={id+"kind"} label="Wie genau ist die Dauer bekannt?" value={base.kind} options={Object.entries(residenceKindLabels)} onChange={v=>changeKind(v as TargetZoneResidence["kind"])}/>
      {(base.kind === "exact" || base.kind === "approximate") && numeric("value", "Dauer")}
      {base.kind === "range" && numeric("lower", "Dauer von")}
      {(base.kind === "range" || base.kind === "upper_bound") && numeric("upper", base.kind === "upper_bound" ? "Obere Dauergrenze" : "Dauer bis")}
      {base.kind === "range" && <Choice id={id+"lowerInclusive"} label="Untere Grenze" value={String(base.lowerInclusive)} options={[["true","Ab einschließlich"],["false","Mehr als"]]} onChange={v=>set({lowerInclusive:v === "true"})}/>}
      {(base.kind === "range" || base.kind === "upper_bound") && <Choice id={id+"upperInclusive"} label="Obere Grenze" value={String(base.upperInclusive)} options={[["false","Unter (strikt kleiner)"],["true","Bis einschließlich"]]} onChange={v=>set({upperInclusive:v === "true"})}/>}
      {base.kind !== "unknown" && <Choice id={id+"unit"} label="Einheit der Verweildauer" value={base.unit} options={[["minute","Minuten"],["hour","Stunden"],["day","Tage"]]} onChange={v=>set({unit:v as TargetZoneResidence["unit"]})}/>}
      <FieldDescription>„Unter 1 Tag“: Obergrenze wählen, 1 Tag und „Unter (strikt kleiner)“. Daraus wird keine exakte Dauer berechnet.</FieldDescription>
      {([0,1] as const).map(i=><Field key={i}><FieldLabel htmlFor={id+"zone"+i}>Zielzone der Dauerangabe · {i === 0 ? "von" : "bis"} (%)</FieldLabel><Input id={id+"zone"+i} type="number" min="0" step="any" value={Number.isFinite(base.zone[i]) ? base.zone[i] : ""} onChange={e=>{const next:[number,number]=[...base.zone];next[i]=e.target.value === "" ? NaN : Number(e.target.value);set({zone:next});}}/></Field>)}
      <FieldDescription>Dieser Zonenbezug bleibt für die Dauerangabe erhalten, wenn die allgemeine Zielzone später geändert wird.</FieldDescription>
      <Field><FieldLabel htmlFor={id+"original"}>Ursprüngliche Dauerangabe (optional)</FieldLabel><Input id={id+"original"} maxLength={2000} placeholder="Zum Beispiel: insgesamt acht Stunden" value={base.originalText ?? ""} onChange={e=>set({originalText:e.target.value || null})}/></Field>
      <details><summary className="text-sm">Messweise für Dauervergleiche</summary><FieldGroup>
        <Choice id={id+"basis"} label="Zeitbasis" value={base.timeBasis} options={[["unknown","Noch offen"],["calendar","Kalenderzeit"],["trading","Handelszeit"]]} onChange={v=>set({timeBasis:v as TargetZoneResidence["timeBasis"]})}/>
        <Field><FieldLabel htmlFor={id+"convention"}>Messkonvention (optional)</FieldLabel><Input id={id+"convention"} maxLength={2000} placeholder="Zum Beispiel: erster Aufenthalt, Eintritt bis Austritt" value={base.measurementConvention ?? ""} onChange={e=>set({measurementConvention:e.target.value || null})}/></Field>
        <FieldDescription>Ohne geklärte Zeitbasis und Messkonvention wird die Angabe erfasst, aber nicht in einen vergleichenden Dauermittelwert aufgenommen.</FieldDescription>
      </FieldGroup></details>
      <p className="text-sm" aria-live="polite">{residenceLabel(value)}</p>
    </FieldGroup>}
  </FieldSet>;
}
