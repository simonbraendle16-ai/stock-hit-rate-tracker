import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { listAssistantTokens } from '@/app/actions/assistant-tokens'
import { AssistantTokenWorkspace } from '@/components/assistant-token-workspace'

export default async function AssistantApiSettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')
  const tokens = await listAssistantTokens()
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link href="/settings" className="font-mono text-xs text-muted-foreground hover:text-foreground">← Einstellungen</Link>
      <p className="eyebrow mt-10">Verbindung</p>
      <h1 className="mt-2 font-heading text-3xl font-semibold text-foreground">Persönliche API-Schlüssel</h1>
      <p className="note mt-3 max-w-2xl">Ein Schlüssel erlaubt einem Assistenten, ausgewählte Daten deines Journals zu lesen oder zu schreiben. Du kannst ihn hier jederzeit widerrufen.</p>
      <AssistantTokenWorkspace tokens={tokens.map((token) => ({ ...token,
        createdAt: token.createdAt.toISOString(), lastUsedAt: token.lastUsedAt?.toISOString() ?? null }))} />
    </main>
  )
}
