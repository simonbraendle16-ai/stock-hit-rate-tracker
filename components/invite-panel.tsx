'use client'

// Einladen & Einlösen (Etappe 2). Kein E-Mail-Versand: Du erzeugst einen Code
// und gibst ihn über einen beliebigen Kanal weiter; der andere löst ihn hier
// ein. Aus dem Einlösen entsteht die gegenseitige Freundschaft.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createInvite, redeemInvite } from '@/app/actions/friends'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Copy, Check, UserPlus, Ticket } from 'lucide-react'

export function InvitePanel() {
  const router = useRouter()
  const [code, setCode] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [creating, setCreating] = useState(false)

  const [redeemValue, setRedeemValue] = useState('')
  const [redeeming, setRedeeming] = useState(false)

  const generate = async () => {
    setCreating(true)
    try {
      const res = await createInvite()
      setCode(res.code)
      setExpiresAt(res.expiresAt)
      setCopied(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
    } finally {
      setCreating(false)
    }
  }

  const copy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast.success('Code kopiert.')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Kopieren nicht möglich — Code bitte manuell markieren.')
    }
  }

  const redeem = async () => {
    if (!redeemValue.trim()) {
      toast.error('Bitte einen Einladungscode eingeben.')
      return
    }
    setRedeeming(true)
    try {
      const res = await redeemInvite(redeemValue)
      toast.success(`Ihr seid jetzt befreundet: ${res.name}.`)
      setRedeemValue('')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Fehler')
    } finally {
      setRedeeming(false)
    }
  }

  const expiryLabel = expiresAt
    ? new Date(expiresAt).toLocaleDateString('de-DE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : null

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Code erzeugen */}
      <div className="glass-card flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2">
          <Ticket className="size-4 text-primary" />
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Freund einladen
          </p>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          Erzeuge einen Code und gib ihn deinem Bekannten — über einen beliebigen Kanal. Löst er ihn
          ein, seht ihr gegenseitig eure Disziplin und abgeschlossenen Trades in R.
        </p>

        {code ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <code className="input-ocean flex-1 select-all rounded-lg px-3 py-2 font-mono text-lg font-bold tracking-[0.3em] text-foreground">
                {code}
              </code>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={copy}
                aria-label="Code kopieren"
                className="shrink-0"
              >
                {copied ? <Check className="size-4 text-positive" /> : <Copy className="size-4" />}
              </Button>
            </div>
            {expiryLabel && (
              <p className="font-mono text-[10px] text-muted-foreground">
                Gültig bis {expiryLabel} · einmal einlösbar
              </p>
            )}
            <button
              type="button"
              onClick={generate}
              disabled={creating}
              className="self-start font-mono text-[11px] text-primary hover:underline disabled:opacity-50"
            >
              Neuen Code erzeugen
            </button>
          </div>
        ) : (
          <Button
            type="button"
            onClick={generate}
            disabled={creating}
            className="btn-teal-glow font-mono text-sm font-bold tracking-wider"
          >
            <Ticket className="size-4" /> {creating ? 'WIRD ERZEUGT…' : 'CODE ERZEUGEN'}
          </Button>
        )}
      </div>

      {/* Code einlösen */}
      <div className="glass-card flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2">
          <UserPlus className="size-4 text-primary" />
          <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Code einlösen
          </p>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          Hast du einen Code bekommen? Trage ihn hier ein, um die Freundschaft anzunehmen.
        </p>
        <div className="mt-auto space-y-2">
          <Label className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Einladungscode
          </Label>
          <div className="flex gap-2">
            <Input
              value={redeemValue}
              onChange={(e) => setRedeemValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') redeem()
              }}
              placeholder="z. B. K7QM4T2P"
              className="input-ocean font-mono uppercase tracking-[0.2em]"
            />
            <Button
              type="button"
              onClick={redeem}
              disabled={redeeming}
              className="btn-teal-glow shrink-0 font-mono text-sm font-bold tracking-wider"
            >
              {redeeming ? '…' : 'EINLÖSEN'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
