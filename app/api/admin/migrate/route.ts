/**
 * 一時マイグレーション実行ルート（実行後に削除すること）
 * POST /api/admin/migrate?secret=<TRIAL_ADMIN_KEY>
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.TRIAL_ADMIN_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = getSupabaseAdmin()
  const results: string[] = []

  // ALTER TABLE はREST APIで直接実行できないため、カラム存在確認後に
  // push_sub列が存在するかチェックし、存在するなら device_fingerprint は
  // Supabase Dashboard の SQL Editorで手動実行が必要。
  // ここではカラムが使えるか検証する。
  const testId = 'migration-test-00000000'

  // カラム存在チェック
  const { error: checkErr } = await supabase
    .from('users')
    .upsert({ id: testId, device_fingerprint: 'migration_test' }, { onConflict: 'id' })

  if (checkErr?.message?.includes('device_fingerprint')) {
    results.push('❌ device_fingerprint カラムが存在しません。Supabase Dashboard の SQL Editor で以下を実行してください:')
    results.push('ALTER TABLE users ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;')
    results.push('CREATE INDEX IF NOT EXISTS idx_users_device_fingerprint ON users(device_fingerprint);')
    return NextResponse.json({ ok: false, results })
  }

  // クリーンアップ
  await supabase.from('users').delete().eq('id', testId)
  results.push('✅ device_fingerprint カラムが正常に存在します')

  // 既存の重複push_sub（同じendpointを持つ複数ユーザー）を一括クリーンアップ
  // push_sub->>'endpoint' が重複しているユーザーの古い方をnullにする
  const { data: pushUsers } = await supabase
    .from('users')
    .select('id, push_sub, created_at')
    .not('push_sub', 'is', null)
    .order('created_at', { ascending: true })

  if (pushUsers) {
    const endpointMap = new Map<string, string[]>()
    for (const u of pushUsers) {
      const ep = (u.push_sub as any)?.endpoint
      if (!ep) continue
      if (!endpointMap.has(ep)) endpointMap.set(ep, [])
      endpointMap.get(ep)!.push(u.id)
    }

    let cleared = 0
    for (const [, ids] of endpointMap) {
      if (ids.length <= 1) continue
      // 最後のもの（最新）を残し、他をクリア
      const toNull = ids.slice(0, -1)
      await supabase.from('users').update({ push_sub: null }).in('id', toNull)
      cleared += toNull.length
    }
    results.push(`✅ 重複endpoint ${cleared}件の古いpush_subをクリアしました`)
  }

  return NextResponse.json({ ok: true, results })
}
