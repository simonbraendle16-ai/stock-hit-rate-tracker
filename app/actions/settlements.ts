'use server'

import { auth } from '@/lib/auth'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tradeSettlementReceipt } from '@/lib/db/schema'
import { ApiError } from '@/lib/assistant-api'
import { saveSettlementReceipt } from '@/lib/settlement-service'
import { receiptSignature } from '@/lib/settlement-receipt'

export type ReceiptFormState = { error?: string; message?: string }

export async function saveReceiptAction(_previous: ReceiptFormState, form: FormData): Promise<ReceiptFormState> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return { error: 'Bitte anmelden.' }
    const eventId = Number(form.get('eventId'))
    const expectedVersion = Number(form.get('expectedVersion'))
    if (!Number.isSafeInteger(eventId) || eventId <= 0 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      return { error: 'Ungültiges Ereignis oder Versionsnummer.' }
    }
    const number = (name: string) => {
      const value = String(form.get(name) ?? '').trim()
      if (!value) return null
      return Number(value)
    }
    const raw = { source: 'manual_broker_receipt', capturedAt: new Date().toISOString(),
      currency: form.get('currency'), netAmount: number('netAmount'), grossAmount: number('grossAmount'),
      entryFeesTreatment: form.get('entryFeesTreatment'), commission: number('commission'),
      financing: number('financing'), evidence: form.get('evidence'),
      quoteToAccountRate: number('quoteToAccountRate'), fxRateAt: form.get('fxRateAt') || null }
    const saved = await db.transaction(tx => saveSettlementReceipt(tx, session.user.id,
      eventId, raw, expectedVersion, String(form.get('correctionReason') ?? '')))
    const [readBack] = await db.select().from(tradeSettlementReceipt).where(and(eq(tradeSettlementReceipt.id, saved.id),
      eq(tradeSettlementReceipt.userId, session.user.id))).limit(1)
    if (!readBack || receiptSignature(readBack.receipt) !== receiptSignature(saved.receipt)) return { error: 'Rückleseprüfung fehlgeschlagen.' }
    revalidatePath(`/trades/${saved.tradeId}`)
    revalidatePath('/trades')
    revalidatePath('/')
    return { message: `Beleg gespeichert und zurückgelesen, Version ${saved.version}.` }
  } catch (e) {
    return { error: e instanceof ApiError ? e.message : 'Beleg konnte nicht gespeichert werden.' }
  }
}
