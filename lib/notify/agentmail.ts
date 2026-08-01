// Etappe 14: Versandweg für Alarm-Mails — dünne Hülle um die AgentMail-API.
//
// POST https://api.agentmail.to/v0/inboxes/{inbox_id}/messages/send
// Header `Authorization: Bearer <AGENTMAIL_API_KEY>`, Rumpf `to` / `subject` / `text`.
//
// Warum E-Mail und nicht Web-Push: Push ist auf dem iPhone nur nach Installation
// über Safari zum Home-Bildschirm möglich — ein stiller Ausfall genau dort, wo das
// Signal am nötigsten ist. E-Mail kommt auf jedem Gerät an. Web-Push kann später
// obendrauf; die serverseitige Prüfung, die dafür nötig ist, steht mit dieser
// Etappe bereits.
//
// Diese Datei kennt keine Alerts und keine Datenbank. Sie schickt Text an eine
// Adresse und sagt ehrlich, ob es geklappt hat — die Entscheidung, was daraus
// folgt, trifft `lib/alert-run.ts`.

export interface SendMailInput {
  to: string
  subject: string
  text: string
}

export type SendMailResult =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string }

const DEFAULT_API_BASE = 'https://api.agentmail.to/v0'

/**
 * Überschreibbar über `AGENTMAIL_API_BASE`.
 *
 * Nicht aus Flexibilitätsliebe: Ohne diesen Schalter ließe sich der Versandweg —
 * und vor allem das Versprechen „dieselbe Meldung geht nie zweimal raus" — nur
 * mit einem echten Schlüssel und einer echten Mail prüfen. Ein Warnsystem, dessen
 * Zustellweg nie durchgespielt wurde, ist ein Versprechen ohne Beleg.
 */
function apiBase(): string {
  return (process.env.AGENTMAIL_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/+$/, '')
}

/** Wie lange auf den Versand gewartet wird, bevor der Lauf weitergeht. */
const TIMEOUT_MS = 15_000

export interface MailConfig {
  apiKey: string
  inboxId: string
}

/**
 * Zugangsdaten aus der Umgebung. `null`, wenn sie fehlen — das ist ein normaler
 * Zustand (noch nicht eingerichtet), kein Fehler: Die Prüfung läuft trotzdem
 * weiter, die Alerts erscheinen in der App, und die Einstellungen weisen die
 * fehlende Konfiguration sichtbar aus.
 */
export function readMailConfig(): MailConfig | null {
  const apiKey = process.env.AGENTMAIL_API_KEY?.trim()
  const inboxId = process.env.AGENTMAIL_INBOX_ID?.trim()
  if (!apiKey || !inboxId) return null
  return { apiKey, inboxId }
}

export async function sendMail(input: SendMailInput, config: MailConfig): Promise<SendMailResult> {
  const url = `${apiBase()}/inboxes/${encodeURIComponent(config.inboxId)}/messages/send`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: input.to,
        subject: input.subject,
        text: input.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })

    if (!res.ok) {
      // Rumpf mitnehmen, aber kürzen: AgentMail-Fehler sind hilfreich
      // (unbekannte Inbox, ungültiger Schlüssel), ein HTML-Fehlerdokument wäre
      // im Protokoll nur Rauschen.
      const body = (await res.text().catch(() => '')).slice(0, 300)
      return { ok: false, error: `AgentMail ${res.status}: ${body || res.statusText}` }
    }

    const data = (await res.json().catch(() => null)) as { message_id?: string } | null
    return { ok: true, messageId: data?.message_id ?? null }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `AgentMail nicht erreichbar: ${reason}` }
  }
}
