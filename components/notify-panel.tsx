'use client'

import type React from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { BellRing } from 'lucide-react'
import { toast } from 'sonner'
import { Field, FormSection, InlineNotice } from '@/components/form-frame'
import { updateNotifySettings } from '@/app/actions/notifications'
import type { NotifyStatus } from '@/lib/notify/status'

/**
 * Alarm-Zustellung (Etappe 14).
 *
 * Der wichtigste Teil dieses Bausteins ist nicht das Eingabefeld, sondern die
 * Statuszeile. Der Takt der Prüfung kommt von einem externen Dienst, den die App
 * nicht kontrolliert: Wird er nie eingerichtet oder fällt er still aus, sähe hier
 * alles fertig aus — und es käme trotzdem nie eine Meldung. Ein Warnsystem, das
 * seinen eigenen Ausfall verschweigt, ist schlimmer als keines.
 */
export function NotifyPanel({ initial }: { initial: NotifyStatus }) {
  const router = useRouter()
  const [notifyEmail, setNotifyEmail] = useState(initial.notifyEmail ?? '')
  const [notifyByEmail, setNotifyByEmail] = useState(initial.notifyByEmail)
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await updateNotifySettings({
        notifyEmail: notifyEmail.trim() ? notifyEmail.trim() : null,
        notifyByEmail,
      })
      toast.success('Benachrichtigung gespeichert')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <FormSection
        icon={BellRing}
        title="Benachrichtigung"
        hint="Wenn ein Kurs deine Marke erreicht — auch, wenn die App gerade zu ist."
      >
        <StatusRow status={initial} />

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="E-Mail-Adresse">
            <Input
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder={initial.recipient ?? 'adresse@beispiel.de'}
              className="input-ocean h-11 font-mono"
            />
          </Field>
          <Field label="Meldungen per E-Mail">
            <label className="flex h-11 items-center gap-2.5 font-mono text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={notifyByEmail}
                onChange={(e) => setNotifyByEmail(e.target.checked)}
                className="size-4 accent-[var(--accent)]"
              />
              {notifyByEmail ? 'an' : 'aus'}
            </label>
          </Field>
        </div>

        <p className="note">
          Leer bedeutet: die Adresse deines Kontos. Ausgelöste Marken stehen unabhängig davon
          immer im Cockpit — abgeschaltet wird nur der Versand.
        </p>

        <div className="mt-4 flex justify-end">
          <Button
            type="submit"
            disabled={loading}
            className="btn-teal-glow h-11 font-mono text-sm font-bold tracking-wider"
          >
            {loading ? 'WIRD GESPEICHERT…' : 'SPEICHERN'}
          </Button>
        </div>
      </FormSection>
    </form>
  )
}

function StatusRow({ status }: { status: NotifyStatus }) {
  const seit = status.lastCheckAt ? relativeMinutes(status.lastCheckAt) : null

  if (status.health === 'nie_gelaufen') {
    return (
      <InlineNotice tone="warning">
        Es wurde noch nie geprüft. Der Takt kommt von einem externen Dienst — richte den
        GitHub-Actions-Workflow <span className="font-mono">check-alerts.yml</span> ein oder
        rufe <span className="font-mono">/api/cron/check-alerts</span> regelmäßig mit dem
        CRON_SECRET auf.
      </InlineNotice>
    )
  }

  if (status.health === 'takt_fehlt') {
    return (
      <InlineNotice tone="warning">
        Letzter Prüflauf vor {seit}. Das ist zu lange her — der externe Takt läuft
        vermutlich nicht, und erreichte Kursmarken melden sich gerade nicht von selbst.
      </InlineNotice>
    )
  }

  if (status.health === 'kein_versand') {
    return (
      <InlineNotice tone="warning">
        Geprüft wird (zuletzt vor {seit}), aber es kann nichts verschickt werden:{' '}
        <span className="font-mono">AGENTMAIL_API_KEY</span> und{' '}
        <span className="font-mono">AGENTMAIL_INBOX_ID</span> fehlen in der Umgebung.
      </InlineNotice>
    )
  }

  return (
    <div className="font-mono text-xs text-muted-foreground">
      Letzter Prüflauf vor {seit}
      {status.recipient ? (
        <> · Meldungen gehen an {status.recipient}</>
      ) : (
        <> · derzeit ohne Empfänger</>
      )}
      {status.lastError ? (
        <span className="text-[var(--negative)]"> · letzter Lauf mit Fehler: {status.lastError}</span>
      ) : null}
    </div>
  )
}

function relativeMinutes(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.max(0, Math.round(ms / 60_000))
  if (min < 1) return 'weniger als einer Minute'
  if (min === 1) return 'einer Minute'
  if (min < 90) return `${min} Minuten`
  const std = Math.round(min / 60)
  return std === 1 ? 'einer Stunde' : `${std} Stunden`
}
