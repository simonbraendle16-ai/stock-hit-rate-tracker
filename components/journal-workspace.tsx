'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition, type FormEvent } from 'react'
import { createInsight, createJournalEntry, updateInsight, updateJournalEntry } from '@/app/actions/journal'
import type { EvidenceRef, InsightStatus, JournalKind } from '@/lib/journal'

type TradeOption = { id: number; ticker: string; status: string }
type Entry = {
  id: string; tradeId: number | null; occurredAt: string; kind: string
  situation: string; intention: string | null; action: string | null
  thoughts: string | null; reflection: string | null; ruleRef: string | null
  sourceRefs: string[]; version: number; createdAt: string; updatedAt: string
}
type Insight = {
  id: string; statement: string; area: string | null; status: string
  evidenceRefs: EvidenceRef[]; counterEvidenceRefs: EvidenceRef[]
  limits: string | null; proposal: string | null; version: number
  createdAt: string; updatedAt: string
}

const field = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary'
const label = 'block font-mono text-[11px] text-muted-foreground'
const statusNames: Record<string, string> = {
  hypothesis: 'Hypothese', supported: 'gestützt', contradicted: 'widersprochen', discarded: 'verworfen',
}

function dateLabel(raw: string) {
  return new Date(raw).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

function JournalForm({ entry, trades, initialTradeId }: {
  entry?: Entry; trades: TradeOption[]; initialTradeId: number | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setError('')
    startTransition(async () => {
      try {
        const input = {
          tradeId: data.get('tradeId') ? Number(data.get('tradeId')) : null,
          occurredAt: entry?.occurredAt,
          kind: (entry?.kind ?? 'user_note') as JournalKind,
          situation: String(data.get('situation') ?? ''),
          intention: String(data.get('intention') ?? ''),
          action: String(data.get('action') ?? ''),
          thoughts: String(data.get('thoughts') ?? ''),
          reflection: String(data.get('reflection') ?? ''),
          ruleRef: String(data.get('ruleRef') ?? ''),
          sourceRefs: entry?.sourceRefs ?? [],
        }
        if (entry) await updateJournalEntry(entry.id, entry.version, input)
        else {
          await createJournalEntry(input)
          form.reset()
        }
        router.refresh()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen.')
      }
    })
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Trade-Bezug (optional)
          <select name="tradeId" className={`${field} mt-1`} defaultValue={entry?.tradeId ?? initialTradeId ?? ''}>
            <option value="">Ohne einzelnen Trade</option>
            {trades.map((t) => <option key={t.id} value={t.id}>#{t.id} · {t.ticker} · {t.status}</option>)}
          </select>
        </label>
        <label className={label}>Regelbezug (optional)
          <input name="ruleRef" className={`${field} mt-1`} defaultValue={entry?.ruleRef ?? ''} placeholder="Regel-ID oder kurzer Verweis" />
        </label>
      </div>
      <label className={label}>Situation *
        <textarea name="situation" required rows={2} className={`${field} mt-1`} defaultValue={entry?.situation ?? ''} placeholder="Was war der Anlass?" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Ursprüngliche Absicht
          <textarea name="intention" rows={2} className={`${field} mt-1`} defaultValue={entry?.intention ?? ''} />
        </label>
        <label className={label}>Tatsächliche Handlung
          <textarea name="action" rows={2} className={`${field} mt-1`} defaultValue={entry?.action ?? ''} />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Gedanken und Gefühle
          <textarea name="thoughts" rows={3} className={`${field} mt-1`} defaultValue={entry?.thoughts ?? ''} />
        </label>
        <label className={label}>Reflexion
          <textarea name="reflection" rows={3} className={`${field} mt-1`} defaultValue={entry?.reflection ?? ''} />
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button disabled={pending} className="rounded-md bg-primary px-4 py-2 font-mono text-xs text-primary-foreground disabled:opacity-50">
        {pending ? 'Speichert …' : entry ? 'Änderung speichern' : 'Notiz speichern'}
      </button>
    </form>
  )
}

function EvidenceSelect({ name, title, selected, trades, entries }: {
  name: string; title: string; selected: EvidenceRef[]; trades: TradeOption[]; entries: Entry[]
}) {
  const values = selected.map((ref) => `${ref.kind}:${ref.id}`)
  return (
    <label className={label}>{title}
      <select name={name} multiple size={4} defaultValue={values} className={`${field} mt-1`}>
        {trades.map((t) => <option key={`trade:${t.id}`} value={`trade:${t.id}`}>Trade #{t.id} · {t.ticker}</option>)}
        {entries.map((e) => <option key={`journal:${e.id}`} value={`journal:${e.id}`}>Notiz · {e.situation.slice(0, 45)}</option>)}
      </select>
      <span className="mt-1 block text-[11px]">Mehrfachauswahl: Strg bzw. ⌘ gedrückt halten.</span>
    </label>
  )
}

function readRefs(data: FormData, name: string): EvidenceRef[] {
  return data.getAll(name).map((raw) => {
    const value = String(raw)
    const separator = value.indexOf(':')
    return { kind: value.slice(0, separator) as EvidenceRef['kind'], id: value.slice(separator + 1) }
  })
}

function InsightForm({ item, trades, entries, initialTradeId }: {
  item?: Insight; trades: TradeOption[]; entries: Entry[]; initialTradeId: number | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setError('')
    startTransition(async () => {
      try {
        const input = {
          statement: String(data.get('statement') ?? ''),
          area: String(data.get('area') ?? ''),
          status: String(data.get('status') ?? 'hypothesis') as InsightStatus,
          evidenceRefs: readRefs(data, 'evidenceRefs'),
          counterEvidenceRefs: readRefs(data, 'counterEvidenceRefs'),
          limits: String(data.get('limits') ?? ''),
          proposal: String(data.get('proposal') ?? ''),
        }
        if (item) await updateInsight(item.id, item.version, input)
        else {
          await createInsight(input)
          form.reset()
        }
        router.refresh()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Speichern fehlgeschlagen.')
      }
    })
  }
  const initialEvidence = item?.evidenceRefs ?? (initialTradeId ? [{ kind: 'trade' as const, id: String(initialTradeId) }] : [])
  return (
    <form onSubmit={submit} className="space-y-3">
      <label className={label}>Aussage *
        <textarea name="statement" required rows={2} className={`${field} mt-1`} defaultValue={item?.statement ?? ''} placeholder="Welche Beobachtung möchtest du prüfen?" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Lernbereich
          <input name="area" className={`${field} mt-1`} defaultValue={item?.area ?? ''} placeholder="z. B. frühe Ausstiege" />
        </label>
        <label className={label}>Status
          <select name="status" className={`${field} mt-1`} defaultValue={item?.status ?? 'hypothesis'}>
            {Object.entries(statusNames).map(([value, title]) => <option key={value} value={value}>{title}</option>)}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <EvidenceSelect name="evidenceRefs" title="Belege" selected={initialEvidence} trades={trades} entries={entries} />
        <EvidenceSelect name="counterEvidenceRefs" title="Gegenbelege" selected={item?.counterEvidenceRefs ?? []} trades={trades} entries={entries} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Einschränkungen
          <textarea name="limits" rows={2} className={`${field} mt-1`} defaultValue={item?.limits ?? ''} />
        </label>
        <label className={label}>Verbesserungsvorschlag
          <textarea name="proposal" rows={2} className={`${field} mt-1`} defaultValue={item?.proposal ?? ''} />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">Ein Vorschlag wird erst nach deiner ausdrücklichen Entscheidung zur Handelsregel.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <button disabled={pending} className="rounded-md bg-primary px-4 py-2 font-mono text-xs text-primary-foreground disabled:opacity-50">
        {pending ? 'Speichert …' : item ? 'Änderung speichern' : 'Erkenntnis speichern'}
      </button>
    </form>
  )
}

export function JournalWorkspace({ entries, insights, trades, initialTradeId }: {
  entries: Entry[]; insights: Insight[]; trades: TradeOption[]; initialTradeId: number | null
}) {
  const [tab, setTab] = useState<'journal' | 'insights'>('journal')
  const [statusFilter, setStatusFilter] = useState('all')
  const visibleEntries = initialTradeId == null ? entries : entries.filter((entry) => entry.tradeId === initialTradeId)
  const visibleInsights = insights.filter((item) => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false
    if (initialTradeId == null) return true
    return [...item.evidenceRefs, ...item.counterEvidenceRefs]
      .some((ref) => ref.kind === 'trade' && ref.id === String(initialTradeId))
  })
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setTab('journal')} aria-pressed={tab === 'journal'} className={`rounded-md border px-3 py-2 font-mono text-xs ${tab === 'journal' ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}>Journal · {visibleEntries.length}</button>
        <button onClick={() => setTab('insights')} aria-pressed={tab === 'insights'} className={`rounded-md border px-3 py-2 font-mono text-xs ${tab === 'insights' ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}>Erkenntnisse · {visibleInsights.length}</button>
        {initialTradeId != null && <Link href="/journal" className="ml-auto font-mono text-xs text-muted-foreground hover:text-foreground">Filter: Trade #{initialTradeId} ×</Link>}
      </div>

      {tab === 'journal' ? <>
        <section className="panel p-4 sm:p-5">
          <h3 className="mb-4 font-heading text-lg font-semibold">Eine Situation festhalten</h3>
          <JournalForm trades={trades} initialTradeId={initialTradeId} />
        </section>
        <div className="space-y-3">
          {visibleEntries.length === 0 && <p className="panel p-5 text-sm text-muted-foreground">Noch keine Notiz für diese Auswahl.</p>}
          {visibleEntries.map((entry) => <article key={entry.id} className="panel p-4 sm:p-5">
            <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <span>{dateLabel(entry.occurredAt)}</span>
              <span>· {entry.kind === 'user_note' ? 'Persönliche Notiz' : 'Assistenzinterpretation'}</span>
              {entry.tradeId != null && <Link href={`/trades/${entry.tradeId}`} className="text-primary hover:underline">· Trade #{entry.tradeId}</Link>}
            </div>
            <h3 className="font-heading text-base font-semibold text-foreground">{entry.situation}</h3>
            {entry.thoughts && <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{entry.thoughts}</p>}
            {entry.reflection && <p className="mt-2 whitespace-pre-wrap text-sm">{entry.reflection}</p>}
            <details className="mt-4 border-t border-border pt-3">
              <summary className="cursor-pointer font-mono text-xs text-primary">Details und Korrektur</summary>
              <div className="mt-4" key={`${entry.id}-${entry.version}`}><JournalForm entry={entry} trades={trades} initialTradeId={initialTradeId} /></div>
            </details>
          </article>)}
        </div>
      </> : <>
        <section className="panel p-4 sm:p-5">
          <h3 className="mb-4 font-heading text-lg font-semibold">Eine Erkenntnis prüfen</h3>
          <InsightForm trades={trades} entries={entries} initialTradeId={initialTradeId} />
        </section>
        <label className={`${label} max-w-xs`}>Status filtern
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={`${field} mt-1`}>
            <option value="all">Alle</option>
            {Object.entries(statusNames).map(([value, title]) => <option key={value} value={value}>{title}</option>)}
          </select>
        </label>
        <div className="space-y-3">
          {visibleInsights.length === 0 && <p className="panel p-5 text-sm text-muted-foreground">Keine Erkenntnis für diese Auswahl.</p>}
          {visibleInsights.map((item) => <article key={item.id} className="panel p-4 sm:p-5">
            <div className="mb-2 font-mono text-[11px] text-muted-foreground">{statusNames[item.status] ?? item.status} · geändert {dateLabel(item.updatedAt)}</div>
            <h3 className="font-heading text-base font-semibold text-foreground">{item.statement}</h3>
            {item.area && <p className="mt-1 text-xs text-muted-foreground">Bereich: {item.area}</p>}
            <p className="mt-2 text-xs text-muted-foreground">{item.evidenceRefs.length} Belege · {item.counterEvidenceRefs.length} Gegenbelege</p>
            {item.limits && <p className="mt-2 whitespace-pre-wrap text-sm">Grenzen: {item.limits}</p>}
            <details className="mt-4 border-t border-border pt-3">
              <summary className="cursor-pointer font-mono text-xs text-primary">Belege und Korrektur</summary>
              <div className="mt-4" key={`${item.id}-${item.version}`}><InsightForm item={item} trades={trades} entries={entries} initialTradeId={initialTradeId} /></div>
            </details>
          </article>)}
        </div>
      </>}
    </div>
  )
}
