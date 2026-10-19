"use client";
import { useId } from "react";
import { ZONE_TO_PIVOT, durationDefinitions, CALENDAR_TIME_NOTE } from "@/lib/fibonacci-duration-definitions";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import {
  DURATION_CLASSES,
  RESEARCH_LEVELS,
  type ClassifiedDuration,
} from "@/lib/fibonacci-catalogue";

export const levelLabel = (v: number) =>
  `${(v / 100).toLocaleString("de-DE", { maximumFractionDigits: 3 })} · ${v.toLocaleString("de-DE")} %`;
export function CatalogueChoice({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly (readonly [string, string])[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field data-disabled={disabled}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        disabled={disabled}
        items={options.map(([value, label]) => ({ value, label }))}
        value={value}
        onValueChange={(v) => {
          if (v !== null) onChange(v);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
export function ZoneChoice({
  label,
  value,
  onChange,
  point = false,
}: {
  label: string;
  value?: [number, number] | null;
  onChange: (v: [number, number] | null) => void;
  point?: boolean;
}) {
  const options = [
    ["none", "Nicht erhoben"] as const,
    ...RESEARCH_LEVELS.map((v) => [String(v), levelLabel(v)] as const),
  ];
  // Retain unsupported historical boundaries until the user explicitly replaces them.
  for (const n of value ?? [])
    if (!RESEARCH_LEVELS.includes(n))
      options.push([String(n), `${n} % · Altbestand`]);
  const unique = options.filter(
    ([v], i, a) => a.findIndex(([x]) => x === v) === i,
  );
  return (
    <FieldSet>
      <FieldLegend>{label}</FieldLegend>
      <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CatalogueChoice
          label={point ? "Fibonacci-Level" : "Von Level"}
          value={value ? String(value[0]) : "none"}
          options={unique}
          onChange={(v) =>
            onChange(
              v === "none"
                ? null
                : point
                  ? [Number(v), Number(v)]
                  : [Number(v), value?.[1] ?? Number(v)],
            )
          }
        />
        {!point && (
          <CatalogueChoice
            label="Bis Level"
            value={value ? String(value[1]) : "none"}
            options={unique}
            onChange={(v) =>
              onChange(
                v === "none" ? null : [value?.[0] ?? Number(v), Number(v)],
              )
            }
          />
        )}
      </FieldGroup>
    </FieldSet>
  );
}
export function LevelChoices({
  label,
  value = [],
  onChange,
}: {
  label: string;
  value?: number[];
  onChange: (v: number[]) => void;
}) {
  const id = useId(),
    levels = [...new Set([...RESEARCH_LEVELS, ...value])].sort((a, b) => a - b);
  return (
    <FieldSet>
      <FieldLegend>{label}</FieldLegend>
      <FieldDescription>
        Mehrere Levels auswählen. Ohne Auswahl bleibt die Angabe unbekannt.
      </FieldDescription>
      <FieldGroup className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {levels.map((n) => (
          <Field key={n} orientation="horizontal">
            <input
              type="checkbox"
              id={`${id}-${n}`}
              checked={value.includes(n)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...value, n].sort((a, b) => a - b)
                    : value.filter((x) => x !== n),
                )
              }
            />
            <FieldLabel htmlFor={`${id}-${n}`} className="text-xs">
              {levelLabel(n)}
              {!RESEARCH_LEVELS.includes(n) ? " · Altbestand" : ""}
            </FieldLabel>
          </Field>
        ))}
      </FieldGroup>
    </FieldSet>
  );
}
export function DurationChoice({
  label,
  value,
  onChange,
  type,
  zone,
}: {
  label: string;
  value?: ClassifiedDuration | null;
  onChange: (v: ClassifiedDuration | null) => void;
  type: "wave" | "reversal" | "residence";
  zone?: [number, number] | null;
}) {
  const base = value ?? {
    bucket: "unknown",
    timeBasis: "calendar",
    convention:
      type === "wave"
        ? "whole_wave"
        : type === "reversal"
          ? ZONE_TO_PIVOT
          : "unknown",
  };
  return (
    <FieldSet>
      <FieldLegend>{label}</FieldLegend>
      <FieldDescription>
        {type === "reversal" ? durationDefinitions.reversal.description : type === "residence" ? durationDefinitions.residence.description : "Zeit vom Beginn bis zum Ende der untersuchten Welle."} {CALENDAR_TIME_NOTE}
      </FieldDescription>
      {value && (value.timeBasis !== "calendar" || (type === "reversal" && value.convention !== ZONE_TO_PIVOT)) && <FieldDescription>Altangabe mit bisheriger Messweise ({value.timeBasis} / {value.convention}). Sie bleibt unverändert, bis du diese Dauer gezielt neu eingibst.</FieldDescription>}
      <FieldGroup className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CatalogueChoice
          label="Dauerklasse"
          value={value?.bucket ?? "none"}
          options={[
            ["none", "Nicht erhoben"],
            ["unknown", "Unbekannt"],
            ...DURATION_CLASSES.map(([v, l]) => [v, l] as const),
          ]}
          onChange={(v) =>
            onChange(
              v === "none"
                ? null
                : {
                    ...base,
                    timeBasis: "calendar",
                    ...(type === "reversal" ? {convention:ZONE_TO_PIVOT} : {}),
                    bucket: v as ClassifiedDuration["bucket"],
                    ...(type === "residence" || type === "reversal"
                      ? { zone: value?.zone ?? zone ?? undefined }
                      : {}),
                  },
            )
          }
        />
        {value && (
          <>
            {type === "residence" && (
              <CatalogueChoice
                label="Messweise des Aufenthalts"
                value={value.convention}
                options={[
                  ["unknown", "Unbekannt"],
                  ["first_visit", "Erster Aufenthalt"],
                  ["total_visits", "Gesamter Aufenthalt"],
                ]}
                onChange={(v) =>
                  onChange({
                    ...value,
                    timeBasis: "calendar",
                    convention: v as ClassifiedDuration["convention"],
                  })
                }
              />
            )}
          </>
        )}
      </FieldGroup>
      {(type === "residence" || type === "reversal") && value?.zone && (
        <FieldDescription>
          Bezug dieser Dauer: {value.zone.join("–")} %. Der Bezug bleibt bei
          einer Änderung der erwarteten Zone erhalten.
        </FieldDescription>
      )}
      <FieldDescription>
        Untergrenze einschließlich, Obergrenze ausschließlich. Keine Berechnung
        eines Durchschnitts aus Klassenmitten.
      </FieldDescription>
    </FieldSet>
  );
}
