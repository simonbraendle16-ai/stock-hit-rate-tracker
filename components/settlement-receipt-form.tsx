'use client'

import { useActionState } from 'react'
import { saveReceiptAction } from '@/app/actions/settlements'
import type { SettlementReceipt } from '@/lib/settlement-receipt'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'

export function SettlementReceiptForm({ eventId, currency, receipt, version }: {
  eventId: number; currency: string; receipt: SettlementReceipt | null; version: number
}) {
  const [state, action, pending] = useActionState(saveReceiptAction, {})
  const fieldId = (name: string) => `receipt-${eventId}-${name}`
  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="currency" value={currency} />
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={fieldId('netAmount')}>Abgerechnete Netto-P&amp;L ({currency})</FieldLabel>
          <Input id={fieldId('netAmount')} name="netAmount" type="number" step="any" required defaultValue={receipt?.netAmount} />
          <FieldDescription>Den Betrag aus dem Brokerbeleg übernehmen. Verlust negativ, Gewinn positiv.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={fieldId('entryFeesTreatment')}>Einstiegskosten im Nettobetrag</FieldLabel>
          <select id={fieldId('entryFeesTreatment')} name="entryFeesTreatment" required
            defaultValue={receipt?.entryFeesTreatment ?? ''} className="rounded-md border border-input bg-background p-2">
            <option value="" disabled>Im Beleg prüfen</option>
            <option value="included">Alle diesem Ausstieg zugeordneten Einstiegskosten enthalten</option>
            <option value="excluded">Nicht enthalten; gespeicherte Einstiegskosten zusätzlich abziehen</option>
          </select>
          <FieldDescription>Bei unbekannter Kostenbasis die Abrechnung offenlassen.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={fieldId('grossAmount')}>Belegter Bruttobetrag ({currency}, optional)</FieldLabel>
          <Input id={fieldId('grossAmount')} name="grossAmount" type="number" step="any" defaultValue={receipt?.grossAmount ?? ''} />
        </Field>
        <Field>
          <FieldLabel htmlFor={fieldId('commission')}>Enthaltene Provision ({currency}, optional)</FieldLabel>
          <Input id={fieldId('commission')} name="commission" type="number" step="any" min="0" defaultValue={receipt?.commission ?? ''} />
        </Field>
        <Field>
          <FieldLabel htmlFor={fieldId('financing')}>Enthaltene Finanzierung ({currency}, optional)</FieldLabel>
          <Input id={fieldId('financing')} name="financing" type="number" step="any" defaultValue={receipt?.financing ?? ''} />
          <FieldDescription>Belastung positiv, Gutschrift negativ. Enthaltene Kosten werden nicht erneut abgezogen.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor={fieldId('evidence')}>Belegreferenz und geprüfte Kostenbasis</FieldLabel>
          <Textarea id={fieldId('evidence')} name="evidence" required maxLength={4000} defaultValue={receipt?.evidence} />
        </Field>
        {version > 0 ? <Field>
          <FieldLabel htmlFor={fieldId('correctionReason')}>Grund der Belegkorrektur</FieldLabel>
          <Textarea id={fieldId('correctionReason')} name="correctionReason" required maxLength={2000} />
        </Field> : null}
        {state.error ? <p role="alert" className="text-destructive">{state.error}</p> : null}
        {state.message ? <p role="status">{state.message}</p> : null}
        <Button type="submit" disabled={pending}>{pending ? 'Speichern …' : version ? 'Korrektur speichern' : 'Beleg speichern'}</Button>
      </FieldGroup>
    </form>
  )
}
