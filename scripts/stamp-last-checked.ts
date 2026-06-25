/**
 * 全有効条件の最終チェック時刻だけを現在時刻へ更新する。
 * 通知送信やYahoo取得は行わない。
 */
import { getSupabaseAdmin } from '../lib/supabase'

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error(`[設定エラー] 環境変数未設定: NEXT_PUBLIC_SUPABASE_URL=${!!supabaseUrl} SUPABASE_SERVICE_KEY=${!!serviceKey}`)
  }

  const checkedAt = process.env.LAST_CHECKED_AT || new Date().toISOString()
  const { error } = await getSupabaseAdmin()
    .from('conditions')
    .update({ last_checked_at: checkedAt })
    .eq('enabled', true)

  if (error) {
    throw new Error(`[Supabase] last_checked_at更新エラー: ${error.message} (code=${error.code})`)
  }

  const jst = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'medium',
    timeStyle: 'medium',
    hourCycle: 'h23',
  }).format(new Date(checkedAt))
  console.log(`[stamp-last-checked] 全有効条件の最終チェック時刻を更新: ${checkedAt} / JST ${jst}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
