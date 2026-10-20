import type { ReactNode } from 'react'

/** Reference composition; callers supply the existing controlled search field. */
export function ResearchHero({ children }: { children: ReactNode }) {
  return (
    <div className="research-hero">
      <div className="research-hero-inner">
        <p className="research-eyebrow"><span aria-hidden="true" />Elliott-Wellen-Theorie</p>
        <h2>Wellenforschung nach Elliott</h2>
        <p className="research-description">Wellen, Zeiträume und Fibonacci-Levels.<br />Deine Beobachtungen systematisch untersuchen.</p>
        <div className="research-search">{children}</div>
      </div>
    </div>
  )
}
