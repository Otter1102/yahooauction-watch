import { NextRequest, NextResponse } from 'next/server'
import { cleanupEndedHistoryForUser, getHistory } from '@/lib/storage'
import { rateGuard } from '@/lib/apiGuard'

export async function GET(req: NextRequest) {
  const userId = new URL(req.url).searchParams.get('userId')
  if (!userId) return NextResponse.json([])
  const limited = rateGuard(`history-get:${userId}`, 30, 60_000)
  if (limited) return limited
  await cleanupEndedHistoryForUser(userId).catch(e => {
    console.warn('[history] 終了済み履歴削除失敗:', e?.message ?? e)
  })
  const history = await getHistory(userId)
  return NextResponse.json(history)
}
