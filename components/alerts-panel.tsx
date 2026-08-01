'use client'

// Kurs-Alerts im Cockpit (Etappe 3). Zeigt ausgelöste zuoberst (damit nichts
// verloren geht, wenn der Browser zu war) und darunter die noch offenen. Der
// Nutzer kann Benachrichtigungen erlauben, einzelne Alerts wegräumen oder löschen.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createMissingPlanAlerts, dismissAlert, deleteAlert } from '@/app/actions/alerts'
import { alertKindLabel, directionVerb, type AlertView } from '@/lib/alerts'
import { Bell, BellPlus, BellRing, Check, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type Permission = 'default' | 'granted' | 'denied' | 'unsupported'

function readPermission(): Permission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission as Permission
}

export function AlertsPanel({ alerts }: { alerts: AlertView[] }) {
  const router = useRouter()
  const [permission, setPermission] = useState<Permission>('default')
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => setPermission(readPermission()), [])

  const requestPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    try {
      const result = await Notification.requestPermission()
      setPermission(result as Permission)
      if (result === 'granted') toast.success('Benachrichtigungen aktiviert.')
      else if (result === 'denied') toast.error('Benachrichtigungen sind im Browser blockiert.')
    } catch {
      toast.error('Benachrichtigungen konnten nicht aktiviert werden.')
    }
  }

  const [nachruestBusy, setNachruestBusy] = useState(false)

  const nachruesten = async () => {
    setNachruestBusy(true)
    try {
      const { trades, created } = await createMissingPlanAlerts()
      if (created === 0) {
        toast.success('Alles schon gesetzt — es fehlte kein Wecker.')
      } else {
        toast.success(
          `${created} Wecker für ${trades} Trade${trades === 1 ? '' : 's'} gesetzt.`,
        )
      }
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
    } finally {
      setNachruestBusy(false)
    }
  }

  const act = async (id: number, fn: () => Promise<void>, ok: string) => {
    setBusyId(id)
    try {
      await fn()
      toast.success(ok)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
    } finally {
      setBusyId(null)
    }
  }

  const triggered = alerts.filter((a) => a.triggeredAt != null)
  const pending = alerts.filter((a) => a.triggeredAt == null)

  return (
    <div className="panel sheen p-4">
      {/* `flex-wrap`: In der schmalen Cockpit-Spalte passen die beiden Knöpfe
          nicht neben die Überschrift — ohne Umbruch wird der rechte abgeschnitten. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <Bell className="size-3.5" /> Kurs-Alerts
          {pending.length > 0 && (
            <span className="rounded-full border border-primary/40 bg-primary/10 px-1.5 text-[9px] text-primary">
              {pending.length} offen
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Etappe 14: für den Altbestand. Trades, die vor dieser Etappe geplant
              wurden, haben keinen Einstiegs-Wecker — nachgerüstet wird nur auf
              Knopfdruck, nie stillschweigend im Hintergrund. */}
          <Button
            size="sm"
            variant="outline"
            onClick={nachruesten}
            disabled={nachruestBusy}
            className="h-7 gap-1 font-mono text-[10px]"
            title="Setzt fehlende Wecker für alle geplanten und laufenden Trades"
          >
            <BellPlus className="size-3" />
            {nachruestBusy ? 'Wird gesetzt …' : 'Wecker nachrüsten'}
          </Button>
          {permission !== 'granted' && permission !== 'unsupported' && (
            <Button
              size="sm"
              variant="outline"
              onClick={requestPermission}
              className="h-7 gap-1 font-mono text-[10px]"
            >
              <BellRing className="size-3" /> Benachrichtigungen erlauben
            </Button>
          )}
        </div>
      </div>

      {alerts.length === 0 ? (
        <p className="font-mono text-xs text-muted-foreground">
          Keine Alerts gesetzt. Setze einen an einer offenen Position oder beim Aktivieren eines
          Trades — dann musst du nicht am Chart kleben.
        </p>
      ) : (
        <div className="space-y-3">
          {triggered.length > 0 && (
            <div className="space-y-2">
              <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-warning">
                Ausgelöst
              </p>
              {triggered.map((a) => (
                <AlertRow
                  key={a.id}
                  a={a}
                  busy={busyId === a.id}
                  onDismiss={() => act(a.id, () => dismissAlert(a.id), 'Alert weggeräumt.')}
                  onDelete={() => act(a.id, () => deleteAlert(a.id), 'Alert gelöscht.')}
                />
              ))}
            </div>
          )}
          {pending.length > 0 && (
            <div className="space-y-2">
              {triggered.length > 0 && (
                <p className="font-mono text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                  Offen
                </p>
              )}
              {pending.map((a) => (
                <AlertRow
                  key={a.id}
                  a={a}
                  busy={busyId === a.id}
                  onDismiss={() => act(a.id, () => dismissAlert(a.id), 'Alert weggeräumt.')}
                  onDelete={() => act(a.id, () => deleteAlert(a.id), 'Alert gelöscht.')}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AlertRow({
  a,
  busy,
  onDismiss,
  onDelete,
}: {
  a: AlertView
  busy: boolean
  onDismiss: () => void
  onDelete: () => void
}) {
  const fired = a.triggeredAt != null
  const firedLabel = a.triggeredAt
    ? new Date(a.triggeredAt).toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg border px-3 py-2',
        fired ? 'border-warning/40 bg-warning/5' : 'border-border bg-background/40',
      )}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 font-mono text-xs">
          {/* Der Puls ist an echten Zustand gebunden: ein offener Alert wartet
              tatsächlich auf eine Kursmarke. Ausgelöste stehen still — und an
              Kursdaten pulst nichts, die sind bis zu 5 Minuten alt. */}
          <span
            className={cn(
              'dot shrink-0',
              fired ? 'text-warning' : 'dot-pulse dot-glow text-primary',
            )}
            aria-hidden="true"
          />
          <span className="font-bold text-foreground">{a.ticker}</span>
          <span className="text-muted-foreground">
            {directionVerb(a.direction)}{' '}
            <span className="text-foreground">
              {a.price.toLocaleString('de-DE', { maximumFractionDigits: 4 })}
            </span>
          </span>
          {a.kind !== 'manuell' && (
            <span className="rounded border border-primary/30 px-1 text-[9px] uppercase tracking-wider text-primary/80">
              {alertKindLabel(a.kind)}
            </span>
          )}
        </p>
        {(a.note || firedLabel) && (
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {fired && firedLabel ? `Ausgelöst ${firedLabel}` : ''}
            {fired && firedLabel && a.note ? ' · ' : ''}
            {a.note ?? ''}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {/* Etappe 14: Ein erreichter Einstieg ist der einzige Alert, an dem
            unmittelbar eine Entscheidung hängt — er führt deshalb direkt in die
            Einstiegs-Ansicht statt nur in die Trade-Übersicht. Stop und Ziel
            gehören zu einem laufenden Trade und brauchen diesen Weg nicht. */}
        {fired && a.kind === 'einstieg' && a.tradeId != null && (
          <Link
            href={`/trades/${a.tradeId}/einstieg`}
            className="rounded border border-primary/40 bg-primary/10 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-primary hover:bg-primary/20"
          >
            Einstieg
          </Link>
        )}
        {fired && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onDismiss}
            title="Weggeräumt"
            className="size-7 p-0 text-muted-foreground hover:text-positive"
          >
            <Check className="size-3.5" />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onDelete}
          title="Löschen"
          className="size-7 p-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
