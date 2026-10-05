'use client'

import { Field } from '@/components/form-frame'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PlanContext } from '@/lib/plan-context'
import { useId } from 'react'

export function PlanContextFields({ value, onChange, disabled = false }: {
  value: PlanContext; onChange: (value: PlanContext) => void; disabled?: boolean
}) {
  const riskId = useId()
  return <div className="flex flex-col gap-4">
    {([
      ['expectedMove', 'Erwarteter Verlauf', 'Dein Count oder erwarteter Verlauf; verbleibende Unsicherheit darf benannt werden.'],
      ['entryTrigger', 'Konkreter Einstiegsauslöser', 'Welche vorher festgelegte Bedingung löst den Einstieg aus?'],
      ['stopManagement', 'Stop-Management', 'Wann darf der Stop nachgezogen werden? Auch „kein Nachzug“ ist eine Angabe.'],
      ['targetManagement', 'Ziel-Management', 'Ziele und Teilausstiege; auch „vollständig am Ziel, keine Teilausstiege“ ist eine Angabe.'],
    ] as const).map(([key, label, placeholder]) => <Field key={key} label={label}>
      <Textarea aria-label={label} value={value[key]} placeholder={placeholder} maxLength={4000} disabled={disabled}
        onChange={e => onChange({ ...value, [key]: e.target.value, riskConfirmed: false })} />
    </Field>)}
    <div className="flex items-start gap-2">
      <Input type="checkbox" className="size-4" id={riskId} checked={value.riskConfirmed} disabled={disabled}
        onChange={e => onChange({ ...value, riskConfirmed: e.target.checked })} />
      <Label htmlFor={riskId}>Ich habe Positionsgröße, Währung und Stop-Risiko geprüft;
        bekannte Kosten und Datenlücken sind benannt.</Label>
    </div>
    <p className="note">Fehlende Planangaben lassen sich als Entwurf speichern. Gefühle und Unsicherheit sind keine Regelverstöße.</p>
  </div>
}
