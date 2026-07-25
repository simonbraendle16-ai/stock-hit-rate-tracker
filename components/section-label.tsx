import type React from 'react'
import { cn } from '@/lib/utils'

/**
 * Sektionsbeschriftung mit auslaufender Haarlinie. Gliedert lange Seiten,
 * ohne eine zweite Überschriftenebene aufzumachen — die einzige große
 * Typografie einer Seite bleibt die Hero-Kennzahl.
 */
export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('section-rule mb-3.5', className)}>
      <span className="eyebrow">{children}</span>
    </div>
  )
}
