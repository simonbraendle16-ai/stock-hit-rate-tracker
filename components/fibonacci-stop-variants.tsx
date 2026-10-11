"use client";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/components/ui/select";
import type { StopVariant } from "@/lib/fibonacci";
export function StopVariantsEditor({
  value,
  onChange,
}: {
  value: StopVariant[];
  onChange: (v: StopVariant[]) => void;
}) {
  const prefix = useId();
  const set = (index: number, key: keyof StopVariant, raw: string) =>
    onChange(
      value.map((v, i) =>
        i === index
          ? {
              ...v,
              [key]:
                key === "resultR" ? (raw === "" ? null : Number(raw)) : raw,
            }
          : v,
      ),
    );
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-medium">
        Stopvarianten · dokumentierte Nutzereinschätzungen
      </h3>
      <p className="text-xs text-muted-foreground">
        Mehrere Varianten derselben Welle; tatsächliche und hypothetische
        Ergebnisse getrennt. Keine Simulation und keine Netto-Trade-Kennzahlen.
      </p>
      {value.map((v, i) => (
        <div
          key={i}
          className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
        >
          {(["label", "description", "resultR"] as const).map((k) => (
            <Field key={k}>
              <FieldLabel htmlFor={prefix + i + k}>
                {
                  {
                    label: "Variantenname",
                    description: "Stopbezug / Beschreibung",
                    resultR: "Ergebnis in R (optional, Nutzerangabe)",
                  }[k]
                }
              </FieldLabel>
              <Input
                id={prefix + i + k}
                type={k === "resultR" ? "number" : "text"}
                step="any"
                required={k !== "resultR"}
                value={v[k] ?? ""}
                onChange={(e) => set(i, k, e.target.value)}
              />
            </Field>
          ))}
          {(["kind", "outcome"] as const).map((k) => {
            const values =
              k === "kind"
                ? ["hypothetisch", "tatsaechlich"]
                : [
                    "unbekannt",
                    "gewinn",
                    "verlust",
                    "breakeven",
                    "ausgelassen",
                  ];
            const id = prefix + i + k;
            return (
              <Field key={k}>
                <FieldLabel htmlFor={id}>
                  {k === "kind" ? "Ergebnisart" : "Ausgang"}
                </FieldLabel>
                <Select
                  value={v[k]}
                  items={values.map((value) => ({
                    value,
                    label: value === "tatsaechlich" ? "Tatsächlich" : value,
                  }))}
                  onValueChange={(raw) => set(i, k, String(raw))}
                >
                  <SelectTrigger id={id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {values.map((raw) => (
                        <SelectItem key={raw} value={raw}>
                          {raw === "tatsaechlich" ? "Tatsächlich" : raw}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            Variante entfernen
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={value.length >= 20}
        onClick={() =>
          onChange([
            ...value,
            {
              label: "",
              description: "",
              kind: "hypothetisch",
              outcome: "unbekannt",
              resultR: null,
            },
          ])
        }
      >
        Stopvariante ergänzen
      </Button>
    </div>
  );
}
