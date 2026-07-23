'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { cashflow, trade, userSettings } from '@/lib/db/schema'
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
  startCapital: number
  defaultRiskPct: number
  maxRiskPct: number
  /** Kontowährung — reine Anzeigeebene, Kurse werden nicht umgerechnet. */
  currency: string
  /** Vorbelegung der Ordergebühren im Trade-Formular. */
  defaultFeeEntry: number
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

/** Einstellungen speichern (Upsert). */
export async function updateSettings(input: {
  startCapital: number
  defaultRiskPct: number
  maxRiskPct: number
  currency?: string
  defaultFeeEntry?: number
  defaultFeeExit?: number
}): Promise<void> {
  const userId = await getUserId()
  const current = await getSettings()
  const values = {
    startCapital: clampPositive(input.startCapital, DEFAULTS.startCapital),
    defaultRiskPct: clampPct(input.defaultRiskPct, DEFAULTS.defaultRiskPct),
    maxRiskPct: clampPct(input.maxRiskPct, DEFAULTS.maxRiskPct),
    // Die Währung ändert NUR die Anzeige. Bestehende Beträge werden hier nicht
    // angefasst — dafür gibt es den ausdrücklichen Umrechnungs-Vorgang.
    currency: clampCurrency(input.currency, current.currency),
    defaultFeeEntry: clampFee(input.defaultFeeEntry ?? current.defaultFeeEntry, DEFAULTS.defaultFeeEntry),
    defaultFeeExit: clampFee(input.defaultFeeExit ?? current.defaultFeeExit, DEFAULTS.defaultFeeExit),
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
  startCapital: number
  defaultRiskPct: number
  maxRiskPct: number
  defaultFeeEntry: number
  defaultFeeExit: number
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
  }

  const values = {
    startCapital: clampPositive(
      rate != null ? input.startCapital * rate : input.startCapital,
      DEFAULTS.startCapital,
    ),
    defaultRiskPct: clampPct(input.defaultRiskPct, DEFAULTS.defaultRiskPct),
    maxRiskPct: clampPct(input.maxRiskPct, DEFAULTS.maxRiskPct),
    currency: target,
    defaultFeeEntry: clampFee(
      rate != null ? input.defaultFeeEntry * rate : input.defaultFeeEntry,
      DEFAULTS.defaultFeeEntry,
    ),
    defaultFeeExit: clampFee(
      rate != null ? input.defaultFeeExit * rate : input.defaultFeeExit,
      DEFAULTS.defaultFeeExit,
    ),
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
