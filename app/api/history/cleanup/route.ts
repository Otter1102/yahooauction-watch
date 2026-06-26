import { NextRequest, NextResponse } from 'next/server'
import { rateGuard } from '@/lib/apiGuard'

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

    // 履歴消失の報告が出たため、削除処理は一時停止。
    // 復旧後は「DBから削除」ではなく「表示だけ非表示」に切り替える。
    return NextResponse.json({ deleted: 0, disabled: true })
  } catch {
    return NextResponse.json({ deleted: 0 })
  }
}
