// Die Instrumentenkarte: Prognosen UND Trades eines Wertes an einer Stelle.
//
// Warum es das braucht: Die beiden Welten lagen bisher auf getrennten Seiten —
// `/analysis` kannte nur Prognosen, `/tracking` nur Trades ohne Instrumentbezug.
// Dadurch war die eigentliche Frage nirgends zu beantworten: Liegt es an meiner
// Analyse oder an meiner Umsetzung? Genau diese Differenz steht hier unten in
// der Karte.
//
// Zwei Festlegungen, die man der Karte ansehen soll:
//   * Echtgeld und Demo stehen IMMER getrennt. Eine schöne Quote, die aus
//     Papertrades stammt, ist die naheliegendste Selbsttäuschung überhaupt —
//     die Karte macht sie unmöglich.
//   * Die Trefferquote wird immer gezeigt, aber unter der Belastbarkeitsschwelle
//     mit ihrer Grundlage darunter. „100 %" aus einem einzigen Trade darf nicht
//     aussehen wie „100 %" aus dreißig.
//
// Geändert in Etappe 12: Die Demo-Zeile zeigt jetzt auch einen Geldbetrag. Vorher
// war er unterdrückt, weil er ohne Bezugsgröße erfunden gewesen wäre; seit jedes
// Übungsdepot ein Papier-Startkapital hat, stammt er nachvollziehbar von dort.
// Er steht im Goldton, nicht in Grün/Rot — Papiergeld darf nie aussehen wie ein
// echter Gewinn. Die TRENNUNG der beiden Zeilen bleibt unverändert.

import Link from 'next/link'
import type { InstrumentStats } from '@/lib/instrument-stats'
import { MIN_INSTRUMENT_TRADES } from '@/lib/instrument-stats'
import { formatMoney } from '@/lib/format'

const MARKET_LABELS: Record<string, string> = {
  aktien: 'Aktien',
  krypto: 'Krypto',
  forex: 'Forex',
  rohstoffe: 'Rohstoffe',
  etf: 'ETF',
  optionen: 'Optionen',
  sonstiges: 'Sonstiges',
}

export interface InstrumentQuote {
  price: number
  changePct: number | null
  currency: string | null
}

function pct(v: number): string {
  return `${v.toFixed(0)} %`
}

function rValue(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)} R`
}

/** Waagerechter Anteilsbalken — dieselbe Sprache wie die Disziplin-Anzeigen. */
function RateBar({ value, tone }: { value: number; tone: 'gut' | 'schlecht' }) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div
      className="panel-sunken h-1.5 w-16 overflow-hidden rounded-full"
      role="presentation"
      aria-hidden="true"
    >
      <div
        className={`h-full rounded-full ${tone === 'gut' ? 'bg-positive' : 'bg-destructive'}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

/** Eine Kennzahlzeile: Beschriftung, Anzahl, Quote, Zusatz. */
function StatRow({
  label,
  count,
  countLabel,
  rate,
  extra,
}: {
  label: string
  count: number
  countLabel: string
  rate: number | null
  extra?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="w-14 shrink-0 font-mono text-xs text-foreground" title={countLabel}>
        {count}
      </span>
      {rate === null ? (
        <span className="flex-1 font-mono text-xs text-muted-foreground">—</span>
      ) : (
        <span className="flex flex-1 items-center gap-2">
          <span
            className={`font-mono text-xs ${rate >= 50 ? 'text-positive' : 'text-destructive'}`}
          >
            {pct(rate)}
          </span>
          <RateBar value={rate} tone={rate >= 50 ? 'gut' : 'schlecht'} />
        </span>
      )}
      {extra && <span className="shrink-0 font-mono text-xs text-muted-foreground">{extra}</span>}
    </div>
  )
}

export function InstrumentCard({
  stats,
  quote,
  currency = 'EUR',
  href,
  footer,
}: {
  stats: InstrumentStats
  /** Aktueller Kurs aus dem Kursspeicher — optional, die Karte trägt auch ohne. */
  quote?: InstrumentQuote
  /** Kontowährung für Geldbeträge (aus den Einstellungen). */
  currency?: string
  /** Ziel des Kopfbereichs; ohne Angabe ist die Karte nicht verlinkt. */
  href?: string
  /**
   * Bedienelemente am Fuß der Karte (Einschätzung, Chart-Link, Löschen).
   *
   * Bewusst von außen hereingereicht: Die Karte bleibt eine reine Anzeige und
   * kennt keine Server-Actions — sonst könnte sie nicht an vier so
   * verschiedenen Orten stehen.
   */
  footer?: React.ReactNode
}) {
  const a = stats.assessments
  const t = stats.trades
  const up = quote?.changePct != null && quote.changePct >= 0

  const kopf = (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-sm font-bold text-foreground">{stats.ticker}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
        {stats.name} · {MARKET_LABELS[stats.market] ?? stats.market}
      </span>
      {quote && (
        <span className="shrink-0 text-right">
          <span className="font-mono text-sm text-foreground">
            {quote.price.toLocaleString('de-DE', {
              minimumFractionDigits: 2,
              maximumFractionDigits: quote.price >= 100 ? 2 : 4,
            })}
          </span>
          {quote.currency && (
            <span className="ml-1 font-mono text-[9px] text-muted-foreground">
              {quote.currency}
            </span>
          )}
          {quote.changePct != null && (
            <span
              className={`ml-2 font-mono text-[10px] ${up ? 'text-positive' : 'text-destructive'}`}
            >
              {up ? '+' : ''}
              {quote.changePct.toFixed(2)} %
            </span>
          )}
        </span>
      )}
    </div>
  )

  return (
    <div className="panel rise-in flex flex-col gap-2.5 p-3.5">
      {href ? (
        <Link href={href} className="transition-opacity hover:opacity-80">
          {kopf}
        </Link>
      ) : (
        kopf
      )}

      <div className="flex flex-col gap-1.5 border-t border-border/50 pt-2.5">
        <StatRow
          label="Prognosen"
          count={a.total}
          countLabel={`${a.total} Prognosen, davon ${a.decided} entschieden`}
          rate={a.decided > 0 ? a.hitRate : null}
          extra={a.notReached > 0 ? `${a.notReached}× Zone nicht erreicht` : undefined}
        />

        <StatRow
          label="Trades"
          count={t.total}
          countLabel={`${t.total} Trades, davon ${t.decided} entschieden`}
          rate={t.decided > 0 ? t.core.winRate : null}
          extra={t.core.rated > 0 ? `Ø ${rValue(t.core.expectancy)}` : undefined}
        />

        {/* Die Grundlage steht nur dann da, wenn die Quote noch nicht trägt —
            sonst wäre es Lärm auf jeder einzelnen Karte. */}
        {t.decided > 0 && !t.enough && (
          <p className="pl-20 font-mono text-[10px] text-muted-foreground">
            Grundlage: {t.decided} von {MIN_INSTRUMENT_TRADES} entschiedenen Trades
          </p>
        )}

        {(t.money.trades > 0 || t.demo.trades > 0) && (
          <div className="flex flex-col gap-1 pl-20">
            {t.money.trades > 0 && (
              <div className="flex items-center gap-3 font-mono text-[10px]">
                <span className="w-14 shrink-0 text-muted-foreground">Echtgeld</span>
                <span className="w-6 shrink-0 text-foreground">{t.money.trades}</span>
                <span
                  className={
                    t.money.netPnl >= 0 ? 'text-positive' : 'text-destructive'
                  }
                >
                  {formatMoney(t.money.netPnl, currency, { signed: true })}
                </span>
              </div>
            )}
            {t.demo.trades > 0 && (
              <div className="flex items-center gap-3 font-mono text-[10px]">
                <span className="w-14 shrink-0 text-muted-foreground">Demo</span>
                <span className="w-6 shrink-0 text-foreground">{t.demo.trades}</span>
                {/* Seit Etappe 12 steht hier auch ein Betrag. Bis dahin war er
                    bewusst unterdrückt („der wäre erfunden") — und das war
                    richtig, solange Demo-Trades gegen kein eigenes Kapital
                    rechneten. Jetzt hat jedes Übungsdepot ein
                    Papier-Startkapital, der Betrag stammt also nachvollziehbar
                    von dort. Damit er nicht mit echtem Geld verwechselt wird,
                    trägt er den Goldton statt Grün/Rot — dieselbe Farbe wie das
                    PAPIERGELD-Abzeichen. */}
                {t.demo.decided > 0 && (
                  <span className="text-[var(--warning)]">
                    {formatMoney(t.demo.netPnl, currency, { signed: true })}
                  </span>
                )}
                <span className="text-muted-foreground">
                  {t.demo.decided > 0 ? rValue(t.demo.expectancy) : 'noch offen'}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {stats.gap !== null && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/50 pt-2 font-mono text-[10px]">
          <span className="text-muted-foreground">
            Prognose {pct(a.hitRate)} → Umsetzung {pct(t.core.winRate)}
          </span>
          <span
            className={stats.gap > 0 ? 'text-destructive' : 'text-positive'}
            title={
              stats.gap > 0
                ? 'Die Analyse trifft besser als die Umsetzung — die Differenz liegt im Verhalten, nicht in der Prognose.'
                : 'Die Umsetzung hält, was die Analyse verspricht.'
            }
          >
            {stats.gap > 0 ? '−' : '+'}
            {Math.abs(stats.gap).toFixed(0)} Punkte
          </span>
          {t.core.trades > 0 && (
            <span className="ml-auto text-muted-foreground">
              Plan-Treue {pct(t.core.planFollowedRate)}
            </span>
          )}
        </div>
      )}

      {footer && (
        <div className="flex flex-wrap items-center gap-1 border-t border-border/50 pt-2">
          {footer}
        </div>
      )}
    </div>
  )
}
