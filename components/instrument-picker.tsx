"use client";

import { useId, useMemo } from "react";
import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";

type Instrument = { id: number; ticker: string; name: string };
type Option = { value: string; label: string };

export function InstrumentPicker({
  instruments,
  value,
  onChange,
  disabled = false,
}: {
  instruments: Instrument[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const items = useMemo(
    () =>
      instruments.map((i) => ({
        value: String(i.id),
        label: `${i.ticker} · ${i.name}`,
      })),
    [instruments],
  );
  const selected = items.find((item) => item.value === value) ?? null;
  const { contains } = Combobox.useFilter({ sensitivity: "base" });

  return (
    <Field data-disabled={disabled}>
      <Combobox.Root
        items={items}
        value={selected}
        disabled={disabled}
        filter={contains}
        autoHighlight
        onValueChange={(item) => {
          if (item && item.value !== value) onChange(item.value);
        }}
      >
        <Combobox.Label render={<FieldLabel />}>Instrument</Combobox.Label>
        <Combobox.Trigger
          id={id}
          render={
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between"
            />
          }
        >
          <span className="min-w-0 truncate text-left">
            <Combobox.Value placeholder="Instrument auswählen" />
          </span>
          <ChevronDown data-icon="inline-end" />
        </Combobox.Trigger>
        <Combobox.Portal>
          <Combobox.Positioner
            align="start"
            sideOffset={4}
            className="isolate z-[60]"
          >
            <Combobox.Popup
              aria-label="Instrument auswählen"
              className="flex max-h-(--available-height) w-(--anchor-width) min-w-0 flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
            >
              <div className="shrink-0 border-b border-border p-2">
                <Combobox.Input
                  aria-label="Instrumente durchsuchen"
                  placeholder="Name oder Symbol suchen …"
                  render={<Input />}
                />
              </div>
              <Combobox.Empty className="p-3 text-sm text-muted-foreground">
                Kein passendes Instrument gefunden.
              </Combobox.Empty>
              <Combobox.List className="min-h-0 max-h-64 overflow-y-auto p-1">
                <Combobox.Group>
                  <Combobox.Collection>
                    {(item: Option) => (
                      <Combobox.Item
                        key={item.value}
                        value={item}
                        className="flex cursor-default items-center justify-between gap-2 rounded-md px-2 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                      >
                        <span className="min-w-0 break-words">
                          {item.label}
                        </span>
                        <Combobox.ItemIndicator>
                          <Check className="size-4" />
                        </Combobox.ItemIndicator>
                      </Combobox.Item>
                    )}
                  </Combobox.Collection>
                </Combobox.Group>
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      <FieldDescription>
        Nach Instrumentname oder Symbol suchen, dann einen Treffer auswählen.
      </FieldDescription>
    </Field>
  );
}
