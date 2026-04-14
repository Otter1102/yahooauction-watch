import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { checkAuctionEnded } from '@/lib/scraper'
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

    const supabase = getSupabaseAdmin()

    // 30分以上経過したものを対象（直後の誤削除を防ぐ）
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()

    const { data: items } = await supabase
      .from('notification_history')
      .select('id, auction_id')
      .eq('user_id', userId)
      .lt('notified_at', cutoff)
      .limit(5)

    if (!items?.length) return NextResponse.json({ deleted: 0 })

    const toDelete: string[] = []
    for (const item of items) {
      const ended = await checkAuctionEnded(item.auction_id as string)
      if (ended) toDelete.push(item.id as string)
      await new Promise(r => setTimeout(r, 300))
    }

    if (toDelete.length > 0) {
      await supabase
        .from('notification_history')
        .delete()
        .in('id', toDelete)
    }

    return NextResponse.json({ deleted: toDelete.length })
  } catch {
    return NextResponse.json({ deleted: 0 })
  }
}
