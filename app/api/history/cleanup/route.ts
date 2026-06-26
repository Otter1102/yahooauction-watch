import { NextRequest, NextResponse } from 'next/server'
import { rateGuard } from '@/lib/apiGuard'
import { cleanupEndedHistoryForUser } from '@/lib/storage'

/**
 * POST /api/history/cleanup
 * ユーザーの通知履歴から終了済みオークションを削除する
 * 1回あたり最大5件チェック（Yahoo負荷分散）
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ deleted: 0 })
    const limited = rateGuard(`history-cleanup:${userId}`, 5, 60_000)
    if (limited) return limited

    const deleted = await cleanupEndedHistoryForUser(userId)
    return NextResponse.json({ deleted })
  } catch {
    return NextResponse.json({ deleted: 0 })
  }
}
