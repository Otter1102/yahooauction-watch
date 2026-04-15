import { NextRequest, NextResponse } from 'next/server'
import { clearNotifiedHistory } from '@/lib/storage'
import { rateGuard } from '@/lib/apiGuard'

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    const limited = rateGuard(`reset-notified:${userId}`, 3, 60_000)
    if (limited) return limited
    await clearNotifiedHistory(userId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[POST /api/reset-notified]', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
