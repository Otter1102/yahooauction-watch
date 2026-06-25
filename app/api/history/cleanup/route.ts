import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { checkAuctionEnded } from '@/lib/scraper'
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

    const supabase = getSupabaseAdmin()

    const endedAtDeleted = await cleanupEndedHistoryForUser(userId)

    // end_at がない旧データはYahoo確認で削除する。
    // 履歴を開催中だけに保つため、直近通知でも確認対象にする。
    const cutoff = new Date().toISOString()

    const { data: items } = await supabase
      .from('notification_history')
      .select('id, auction_id')
      .eq('user_id', userId)
      .not('auction_id', 'like', '__check_%')
      .lt('notified_at', cutoff)
      .limit(30)

    if (!items?.length) return NextResponse.json({ deleted: endedAtDeleted })

    const toDelete: Array<{ id: string; auctionId: string }> = []
    for (const item of items) {
      const ended = await checkAuctionEnded(item.auction_id as string)
      if (ended) toDelete.push({ id: item.id as string, auctionId: item.auction_id as string })
      await new Promise(r => setTimeout(r, 300))
    }

    if (toDelete.length > 0) {
      await supabase
        .from('notification_history')
        .delete()
        .in('id', toDelete.map(item => item.id))

      for (const item of toDelete) {
        await supabase
          .from('notified_items')
          .delete()
          .eq('user_id', userId)
          .eq('auction_id', item.auctionId)
      }
    }

    return NextResponse.json({ deleted: endedAtDeleted + toDelete.length })
  } catch {
    return NextResponse.json({ deleted: 0 })
  }
}
