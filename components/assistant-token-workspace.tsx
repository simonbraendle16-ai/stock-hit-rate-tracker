'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition, type FormEvent } from 'react'
import { createAssistantToken, revokeAssistantToken } from '@/app/actions/assistant-tokens'
import type { ApiScope } from '@/lib/assistant-api'

type TokenRow = { id: string; name: string; scopes: string[]; createdAt: string; lastUsedAt: string | null }
const labels: Record<ApiScope, string> = {
  'trades:read': 'Trades lesen', 'trades:write': 'Trades schreiben',
  'journal:read': 'Journal und Erkenntnisse lesen', 'journal:write': 'Journal und Erkenntnisse schreiben',
}

export function AssistantTokenWorkspace({ tokens }: { tokens: TokenRow[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [secret, setSecret] = useState<string | null>(null)
  const [error, setError] = useState('')

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const scopes = Object.keys(labels).filter((scope) => data.has(scope)) as ApiScope[]
    setError('')
    startTransition(async () => {
      try {
        const value = await createAssistantToken(String(data.get('name') ?? ''), scopes)
        setSecret(value)
        form.reset()
        router.refresh()
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Schlüssel konnte nicht erstellt werden.') }
    })
  }

  function revoke(id: string) {
    setError('')
    startTransition(async () => {
      try { await revokeAssistantToken(id); router.refresh() }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Widerruf fehlgeschlagen.') }
    })
  }

  return <div className="mt-8 space-y-8">
    {secret && <section className="panel rounded-xl border border-primary/40 p-5" aria-live="polite">
      <h2 className="font-heading text-lg font-semibold">Neuer Schlüssel</h2>
      <p className="note mt-1">Jetzt kopieren und sicher aufbewahren. Nach dem Schließen wird er nicht erneut angezeigt.</p>
      <code className="mt-4 block break-all rounded-md border border-border bg-background p-3 font-mono text-sm select-all">{secret}</code>
      <button type="button" className="mt-3 text-sm text-primary hover:underline" onClick={() => setSecret(null)}>Anzeige schließen</button>
    </section>}
    <form onSubmit={create} className="panel space-y-5 rounded-xl p-5 sm:p-7">
      <h2 className="font-heading text-xl font-semibold">Schlüssel erstellen</h2>
      <label className="block text-sm">Bezeichnung
        <input name="name" required maxLength={80} placeholder="Zum Beispiel Trading-Assistent" className="mt-2 w-full rounded-md border border-border bg-background px-3 py-2" />
      </label>
      <fieldset className="space-y-3"><legend className="text-sm">Rechte</legend>
        {(Object.entries(labels) as [ApiScope, string][]).map(([scope, label]) =>
          <label key={scope} className="flex items-center gap-3 text-sm text-muted-foreground">
            <input type="checkbox" name={scope} defaultChecked={scope.startsWith('journal:')} />{label}
          </label>)}
      </fieldset>
      <button disabled={pending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">Erstellen</button>
    </form>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <section className="panel rounded-xl p-5 sm:p-7">
      <h2 className="font-heading text-xl font-semibold">Aktive Schlüssel</h2>
      {tokens.length === 0 ? <p className="note mt-3">Noch keine Schlüssel vorhanden.</p> :
        <ul className="mt-4 divide-y divide-border">{tokens.map((token) => <li key={token.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
          <div><p className="font-medium">{token.name}</p>
            <p className="note mt-1">{token.scopes.map((scope) => labels[scope as ApiScope] ?? scope).join(' · ')}</p>
            <p className="note mt-1">Erstellt {new Date(token.createdAt).toLocaleDateString('de-DE')}{token.lastUsedAt ? ` · Zuletzt genutzt ${new Date(token.lastUsedAt).toLocaleString('de-DE')}` : ''}</p>
          </div>
          <button type="button" disabled={pending} onClick={() => revoke(token.id)} className="text-sm text-destructive hover:underline disabled:opacity-50">Widerrufen</button>
        </li>)}</ul>}
    </section>
  </div>
}
