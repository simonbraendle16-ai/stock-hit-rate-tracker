'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { cashflow, portfolio, trade, userSettings } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { DEFAULT_ORDER_FEE } from '@/lib/trade-math'

/** Postgres „undefined column" (42703) — Migration 0010 noch nicht angewendet. */
function isMissingColumn(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as { code?: string; cause?: { code?: string }; message?: string }
  return (
    e.code === '42703' ||
    e.cause?.code === '42703' ||
    /currency|defaultFee/.test(e.message ?? '')
  )
}

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export type UserSettings = {
  /**
   * @deprecated Seit Etappe 12 steht das Startkapital am DEPOT
   * (`portfolio.startCapital`). Der Wert hier ist der Altbestand und wird von
   * keiner Kennzahl mehr gelesen — die Auswahl liefert ihn über
   * `loadScopeContext().startCapital`. Nicht für neue Rechnungen verwenden.
   */
  startCapital: number
  defaultRiskPct: number
  maxRiskPct: number
  /** Kontowährung — reine Anzeigeebene, Kurse werden nicht umgerechnet. Global. */
  currency: string
  /** @deprecated Seit Etappe 12 am Depot (`portfolio.defaultFeeEntry`). */
  defaultFeeEntry: number
  /** @deprecated Seit Etappe 12 am Depot (`portfolio.defaultFeeExit`). */
  defaultFeeExit: number
}

const DEFAULTS: UserSettings = {
  startCapital: 10000,
  defaultRiskPct: 1,
  maxRiskPct: 2,
  currency: 'EUR',
  defaultFeeEntry: DEFAULT_ORDER_FEE,
  defaultFeeExit: DEFAULT_ORDER_FEE,
}

/** Einstellungen des Users — liefert Defaults, falls noch keine Zeile existiert. */
export async function getSettings(): Promise<UserSettings> {
  const userId = await getUserId()
  let row
  try {
    ;[row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
  } catch (err) {
    // Migration 0010 fehlt noch → mit den alten Spalten laden, Rest per Default.
    if (!isMissingColumn(err)) throw err
    const [legacy] = await db
      .select({
        startCapital: userSettings.startCapital,
        defaultRiskPct: userSettings.defaultRiskPct,
        maxRiskPct: userSettings.maxRiskPct,
      })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
    return legacy ? { ...DEFAULTS, ...legacy } : { ...DEFAULTS }
  }
  if (!row) return { ...DEFAULTS }
  return {
    startCapital: row.startCapital,
    defaultRiskPct: row.defaultRiskPct,
    maxRiskPct: row.maxRiskPct,
    currency: row.currency ?? DEFAULTS.currency,
    defaultFeeEntry: row.defaultFeeEntry ?? DEFAULTS.defaultFeeEntry,
    defaultFeeExit: row.defaultFeeExit ?? DEFAULTS.defaultFeeExit,
  }
}

function clampPositive(v: number, fallback: number): number {
  return Number.isFinite(v) && v > 0 ? v : fallback
}

function clampPct(v: number, fallback: number): number {
  if (!Number.isFinite(v) || v <= 0) return fallback
  return v > 100 ? 100 : v
}

/** Gebühr darf 0 sein (gebührenfreier Broker), aber nie negativ. */
function clampFee(v: number, fallback: number): number {
  return Number.isFinite(v) && v >= 0 ? v : fallback
}

// Nur Währungen, für die die App eine sinnvolle Formatierung hat.
// Bewusst NICHT exportiert: eine 'use server'-Datei darf ausschließlich async
// Funktionen exportieren — die Liste für die UI steht in `lib/format.ts`.
const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP']

function clampCurrency(v: string | undefined, fallback: string): string {
  const code = (v ?? '').toUpperCase()
  return SUPPORTED_CURRENCIES.includes(code) ? code : fallback
}

/**
 * Die kontoweiten Einstellungen speichern (Upsert).
 *
 * Seit Etappe 12 sind das nur noch drei: Risiko-Vorgaben und Währung. Startkapital
 * und Standardgebühren gehören zum DEPOT und werden über `updatePortfolioMoney`
 * (`app/actions/portfolios.ts`) gepflegt — sie hier weiterhin zu schreiben würde
 * einen zweiten, veralteten Wert erzeugen, den irgendwann jemand ausliest.
 *
 * Die Risiko-Prozente bleiben bewusst kontoweit: „höchstens 2 % pro Trade" ist
 * eine Regel über das eigene Verhalten, keine Eigenschaft eines Kontos — und sie
 * soll in der Übung genauso gelten wie im Ernst.
 */
export async function updateSettings(input: {
  defaultRiskPct: number
  maxRiskPct: number
  currency?: string
}): Promise<void> {
  const userId = await getUserId()
  const current = await getSettings()
  const values = {
    defaultRiskPct: clampPct(input.defaultRiskPct, DEFAULTS.defaultRiskPct),
    maxRiskPct: clampPct(input.maxRiskPct, DEFAULTS.maxRiskPct),
    // Die Währung ändert NUR die Anzeige. Bestehende Beträge werden hier nicht
    // angefasst — dafür gibt es den ausdrücklichen Umrechnungs-Vorgang.
    currency: clampCurrency(input.currency, current.currency),
  }

  await db
    .insert(userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userSettings.userId, set: values })

  revalidateAll()
}

/**
 * Kontowährung wechseln — der einzige Vorgang, der bestehende Geldbeträge
 * verändert.
 *
 * Umgerechnet werden ausschließlich Beträge in Kontowährung: Kapitaleinsatz,
 * eingefrorene Gebühren, Startkapital und Cashflows. KURSE bleiben unangetastet
 * (Einstieg, Stop, Ziel, Ausstieg) — sie notieren in der Währung des Instruments.
 * Deshalb bleiben auch R-Vielfache und Trefferquoten unverändert.
 *
 * `rate = null` stellt nur die Anzeige um, ohne einen Betrag anzufassen.
 */
export async function changeCurrency(input: {
  currency: string
  rate: number | null
  defaultRiskPct: number
  maxRiskPct: number
}): Promise<{ converted: number }> {
  const userId = await getUserId()
  const current = await getSettings()
  const target = clampCurrency(input.currency, current.currency)

  if (input.rate != null && (!Number.isFinite(input.rate) || input.rate <= 0)) {
    throw new Error('Der Umrechnungskurs muss größer als 0 sein.')
  }
  const rate = input.rate

  let converted = 0
  if (rate != null && rate !== 1) {
    // Trades: nur Kontowährungs-Beträge. entryPrice/stopLoss/takeProfit/
    // actualExitPrice bleiben bewusst unberührt.
    const tradeResult = await db
      .update(trade)
      .set({
        investedAmount: sql`${trade.investedAmount} * ${rate}`,
        feeEntry: sql`${trade.feeEntry} * ${rate}`,
        feeExit: sql`${trade.feeExit} * ${rate}`,
      })
      .where(eq(trade.userId, userId))
      .returning({ id: trade.id })
    converted += tradeResult.length

    try {
      const flowResult = await db
        .update(cashflow)
        .set({ amount: sql`${cashflow.amount} * ${rate}` })
        .where(eq(cashflow.userId, userId))
        .returning({ id: cashflow.id })
      converted += flowResult.length
    } catch {
      // Migration 0010 noch nicht angewendet → es gibt schlicht keine Cashflows.
    }

    // Seit Etappe 12 stehen Startkapital und Gebühren an den DEPOTS — sie müssen
    // deshalb hier mit umgerechnet werden. Ohne das stünde nach einem
    // Währungswechsel ein Startkapital in der alten Währung neben Trades in der
    // neuen, und jede Rendite wäre still falsch. Umgerechnet werden ALLE Depots,
    // auch archivierte und das Demo-Depot: Das Papier-Startkapital ist zwar
    // Übungsgeld, notiert aber in derselben Kontowährung.
    const depotResult = await db
      .update(portfolio)
      .set({
        startCapital: sql`${portfolio.startCapital} * ${rate}`,
        defaultFeeEntry: sql`${portfolio.defaultFeeEntry} * ${rate}`,
        defaultFeeExit: sql`${portfolio.defaultFeeExit} * ${rate}`,
      })
      .where(eq(portfolio.userId, userId))
      .returning({ id: portfolio.id })
    converted += depotResult.length
  }

  const values = {
    defaultRiskPct: clampPct(input.defaultRiskPct, DEFAULTS.defaultRiskPct),
    maxRiskPct: clampPct(input.maxRiskPct, DEFAULTS.maxRiskPct),
    currency: target,
  }

  await db
    .insert(userSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userSettings.userId, set: values })

  revalidateAll()
  return { converted }
}

function revalidateAll(): void {
  revalidatePath('/')
  revalidatePath('/tracking')
  revalidatePath('/settings')
  revalidatePath('/trades')
  revalidatePath('/trades/new')
}
