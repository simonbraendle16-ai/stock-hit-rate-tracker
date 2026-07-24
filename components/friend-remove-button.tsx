'use client'

// Freundschaft entfernen (Etappe 2). Zwei-Klick-Bestätigung inline statt Dialog.
// Entfernen macht sofort blind: die Server Action löscht die Freundschaftszeile,
// danach wirft assertCanView für beide Seiten.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { removeFriend } from '@/app/actions/friends'
import { toast } from 'sonner'
import { UserMinus } from 'lucide-react'
import { cn } from '@/lib/utils'

export function FriendRemoveButton({
  friendId,
  name,
  className,
}: {
  friendId: string
  name: string
  className?: string
}) {
  const router = useRouter()
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setBusy(true)
    try {
      await removeFriend(friendId)
      toast.success(`Freundschaft mit ${name} entfernt.`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
      setBusy(false)
      setArmed(false)
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => (armed ? remove() : setArmed(true))}
      onBlur={() => setArmed(false)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide transition-colors disabled:opacity-50',
        armed
          ? 'border-destructive/50 bg-destructive/10 text-destructive'
          : 'border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive',
        className,
      )}
    >
      <UserMinus className="size-3.5" />
      {busy ? 'Entferne…' : armed ? 'Wirklich entfernen?' : 'Entfernen'}
    </button>
  )
}
