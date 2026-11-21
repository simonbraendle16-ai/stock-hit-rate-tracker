import { auth } from '@/lib/auth'
import { projectBPool } from '@/lib/market-data/database'
import { NextRequest, NextResponse } from 'next/server'

const clock = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', dateStyle: 'short' })
const today = () => clock.format(new Date())
const json = (body: object, status = 200) => NextResponse.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
})

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session?.user) return json({}, 401)

  const date = today()
  try {
    const { rows } = await projectBPool().query(
      `WITH expired AS (
         DELETE FROM daily_sheet_check_in WHERE user_id = $1 AND check_in_day < $2::date
       )
       SELECT answers, states FROM daily_sheet_check_in WHERE user_id = $1 AND check_in_day = $2::date`,
      [session.user.id, date],
    )
    return json({ date, answers: [], states: [], ...rows[0] })
  } catch {
    return json({}, 503)
  }
}

function validChoices(value: unknown, limits: number[]): value is number[] {
  return Array.isArray(value) && value.every((item, index) =>
    Number.isInteger(item) && item >= 0 && item < limits[index],
  )
}

export async function PATCH(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session?.user) return json({}, 401)
  if (req.headers.get('sec-fetch-site') === 'cross-site' ||
      req.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({}, 415)

  const patch = await req.json().catch(() => null)
  if (!patch || typeof patch.date !== 'string') return json({}, 400)
  if (patch.date !== today()) return json({}, 409)
  const { answers, states } = patch
  if (answers === undefined && states === undefined) return json({}, 400)
  if (answers !== undefined && (!validChoices(answers, [6, 7, 5]) || answers.length !== 3)) return json({}, 400)
  if (states !== undefined && (!validChoices(states, Array<number>(8).fill(8)) ||
      new Set(states).size !== states.length)) return json({}, 400)

  try {
    const result = await projectBPool().query(
      `INSERT INTO daily_sheet_check_in (user_id, check_in_day, answers, states)
       SELECT $1, $2::date, COALESCE($3::smallint[], '{}'), COALESCE($4::smallint[], '{}')
       WHERE $2::date = (clock_timestamp() AT TIME ZONE 'Europe/Berlin')::date
       ON CONFLICT (user_id) DO UPDATE SET
         check_in_day = EXCLUDED.check_in_day,
         answers = COALESCE($3::smallint[], CASE WHEN daily_sheet_check_in.check_in_day = EXCLUDED.check_in_day THEN daily_sheet_check_in.answers ELSE '{}' END),
         states = COALESCE($4::smallint[], CASE WHEN daily_sheet_check_in.check_in_day = EXCLUDED.check_in_day THEN daily_sheet_check_in.states ELSE '{}' END)
       WHERE daily_sheet_check_in.check_in_day <= EXCLUDED.check_in_day
         AND EXCLUDED.check_in_day = (clock_timestamp() AT TIME ZONE 'Europe/Berlin')::date`,
      [session.user.id, patch.date, answers ?? null, states ?? null],
    )
    return json({}, result.rowCount ? 200 : 409)
  } catch {
    return json({}, 503)
  }
}
