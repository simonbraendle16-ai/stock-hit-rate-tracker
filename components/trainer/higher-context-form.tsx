'use client'

import { useState } from 'react'
import { Lock, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { commitHigherContext } from '@/app/actions/training'
import { MAX_CONTEXT_LEN } from '@/lib/training'
import { toast } from 'sonner'

/**
 * „In welchem übergeordneten Zyklus stehen wir?" — beantwortet, bevor
 * aufgedeckt wird.
 *
 * WARUM DAS FESTGESCHRIEBEN WIRD
 * Dieselbe Logik wie bei der These. Ein Kontext, der sich nachträglich ändern
 * lässt, misst nichts: Man würde ihn — ohne jede böse Absicht — zu dem
 * formulieren, was man inzwischen gesehen hat. Deshalb steht er nach dem
 * Absenden fest, und deshalb prüft das der Server und nicht dieses Formular.
 *
 * WARUM FREITEXT
 * Wie eine Zählung benannt wird, ist persönlich — „Welle 4 einer größeren 3",
 * „Korrektur im Aufwärtstrend", „Spanne seit Mai". Ein Katalog würde vorgeben,
 * was zu sehen ist, und das ist genau das, was der Trainer messen soll.
 *
 * WARUM ES KEINE PFLICHT IST
 * Wer den Kontext nicht lesen kann, soll das sagen dürfen, statt etwas
 * hinzuschreiben. „Ohne Angabe" ist eine ehrliche Antwort; eine erfundene
 * Zählung wäre ein stiller Falschwert.
 */
export function HigherContextForm({
  sessionId,
  vorhanden,
  schreibbar,
}: {
  sessionId: number
  vorhanden: string | null
  /** Steht der Kontext noch offen? Entschieden von `kontextSchreibbar`. */
  schreibbar: boolean
}) {
  const [text, setText] = useState('')
  const [gespeichert, setGespeichert] = useState(vorhanden)
  const [laeuft, setLaeuft] = useState(false)

  if (gespeichert != null && gespeichert.trim() !== '') {
    return (
      <div className="panel-sunken p-3">
        <div className="mb-1.5 flex items-center gap-2">
          <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="section-label">Übergeordneter Kontext · festgeschrieben</span>
        </div>
        <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed">{gespeichert}</p>
      </div>
    )
  }

  if (!schreibbar) {
    return (
      <div className="panel-sunken p-3">
        <div className="mb-1.5 flex items-center gap-2">
          <Layers className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="section-label">Übergeordneter Kontext</span>
        </div>
        <p className="note">
          Ohne Angabe — der Durchlauf läuft bereits. Nachträglich eingetragen wäre der
          Kontext keine Lesung mehr, sondern eine Erinnerung an das Ergebnis.
        </p>
      </div>
    )
  }

  const absenden = () => {
    const wert = text.trim()
    if (wert === '') return
    setLaeuft(true)
    commitHigherContext({ sessionId, text: wert })
      .then((res) => {
        if ('error' in res) {
          toast.error(res.error)
          return
        }
        setGespeichert(wert)
        toast.success('Übergeordneter Kontext festgeschrieben.')
      })
      .catch(() => toast.error('Konnte nicht gespeichert werden.'))
      .finally(() => setLaeuft(false))
  }

  return (
    <div className="panel-sunken p-3">
      <div className="mb-1.5 flex items-center gap-2">
        <Layers className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        <span className="section-label">Übergeordneter Kontext</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, MAX_CONTEXT_LEN))}
        rows={3}
        placeholder="In welchem übergeordneten Zyklus stehen wir? Woran liest du das ab?"
        className="input-ocean w-full rounded-lg px-2.5 py-2 font-mono text-xs leading-relaxed"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          className="h-8 px-3 font-mono text-[11px]"
          disabled={laeuft || text.trim() === ''}
          onClick={absenden}
        >
          Festschreiben
        </Button>
        <span className="font-mono text-[10px] text-muted-foreground">
          {text.length}/{MAX_CONTEXT_LEN} · danach unveränderlich
        </span>
      </div>
      <p className="note mt-1.5">
        Freiwillig. Wenn du den Zyklus nicht sicher liest, lass es leer — das ist eine
        ehrliche Antwort. Der Kontext-Chart über dem Arbeitschart hilft beim Lesen.
      </p>
    </div>
  )
}
