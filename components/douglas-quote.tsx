'use client'

import { useEffect, useState } from 'react'
import { Quote } from 'lucide-react'

const quotes = [
  'Jeder Trade ist einzigartig.',
  'Du weißt nie, was als Nächstes passiert — und musst es nicht, um Geld zu verdienen.',
  'Eine Serie von Verlusten ist normal. Sie ist Teil des Systems.',
  'Langfristig zählt nur der Erwartungswert deiner Strategie.',
  'Meine Aufgabe ist nicht, Recht zu behalten — sondern meinen Plan fehlerfrei auszuführen.',
  'Ich akzeptiere das Risiko vollständig. Der nächste Trade zählt.',
]

/**
 * Sätze für den Moment, in dem ein Einstieg erreicht ist (Etappe 14).
 *
 * Bewusst andere als im Cockpit: Dort begleiten sie den Rückblick, hier stehen
 * sie unmittelbar vor einer Entscheidung. Deshalb erinnern sie an das, was in
 * diesem Moment am schnellsten verloren geht — dass der Plan vorher gefasst
 * wurde und der einzelne Ausgang nichts über seine Güte sagt.
 */
export const ENTRY_QUOTES = [
  'Der Plan steht seit vorhin. Jetzt ist nicht die Zeit, ihn zu verbessern.',
  'Du weißt nicht, was dieser Trade tut — das musst du auch nicht.',
  'Ein guter Trade ist ein plan-konformer Trade. Der Ausgang entscheidet das nicht.',
  'Nicht einzusteigen ist eine gültige Entscheidung — solange sie eine ist und kein Zögern.',
]

/**
 * @param lines Eigene Sätze statt der Cockpit-Auswahl. Bei genau einem Satz
 *              steht er still — eine Rotation im Entscheidungsmoment wäre Unruhe
 *              an der falschen Stelle.
 */
export function DouglasQuote({ lines }: { lines?: readonly string[] } = {}) {
  const list = lines && lines.length > 0 ? lines : quotes
  const [i, setI] = useState(0)
  useEffect(() => {
    if (list.length < 2) return
    const id = setInterval(() => setI((p) => (p + 1) % list.length), 8000)
    return () => clearInterval(id)
  }, [list])
  return (
    <div className="panel sheen flex h-full items-start gap-3 p-4 sm:p-5">
      <Quote className="mt-0.5 size-4 shrink-0 text-primary" />
      <p className="font-heading text-base italic leading-snug text-foreground/90 transition-opacity">
        {list[i % list.length]}
      </p>
    </div>
  )
}
