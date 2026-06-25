import { NextRequest, NextResponse } from 'next/server'
import { rateGuard } from '@/lib/apiGuard'
import { stampEnabledConditionsForUser } from '@/lib/storage'

export async function POST(req: NextRequest) {
  try {
    const { userId, checkedAt } = await req.json()
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId required' }, { status: 400 })
    }

    const limited = rateGuard(`conditions-stamp:${userId}`, 12, 60_000)
    if (limited) return limited

    const stamp = typeof checkedAt === 'string' && !Number.isNaN(Date.parse(checkedAt))
      ? checkedAt
      : new Date().toISOString()
    const updated = await stampEnabledConditionsForUser(userId, stamp)

    return NextResponse.json({ ok: true, checkedAt: stamp, updated })
  } catch (e) {
    console.error('[POST /api/conditions/stamp]', e)
    return NextResponse.json({ ok: false, error: 'Internal Server Error' }, { status: 500 })
  }
}
