import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

/**
 * トライアルトークンを発行する管理者エンドポイント
 * POST /api/trial/generate
 * Body: { adminKey: string }
 * Returns: { url: string, token: string }
 */
export async function POST(req: NextRequest) {
  const { adminKey } = await req.json().catch(() => ({}))

  if (adminKey !== process.env.TRIAL_ADMIN_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ランダムなトークンを生成（32 bytes hex）
  const bytes  = crypto.getRandomValues(new Uint8Array(32))
  const token  = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')

  const { error } = await getSupabaseAdmin()
    .from('trial_tokens')
    .insert({ token })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://yahooauction-watch.vercel.app'
  const url     = `${baseUrl}/start/${token}`

  return NextResponse.json({ url, token })
}
