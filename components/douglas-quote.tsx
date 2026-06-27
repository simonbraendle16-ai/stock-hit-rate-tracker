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

export function DouglasQuote() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setI((p) => (p + 1) % quotes.length), 8000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="glass-card flex items-start gap-3 p-4">
      <Quote className="mt-0.5 size-4 shrink-0 text-primary" />
      <p className="font-mono text-sm italic text-foreground/90 transition-opacity">
        {quotes[i]}
      </p>
    </div>
  )
}
