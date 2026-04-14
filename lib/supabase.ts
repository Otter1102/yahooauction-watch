import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null
let _admin: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    _client = createClient(url, key)
  }
  return _client
}

export function getSupabaseAdmin(): SupabaseClient {
  if (!_admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    _admin = createClient(url, key, {
      global: {
        // タイムアウトを20秒に設定
        // 理由: 30秒だとcron同時起動時にリトライ込みで60秒を超えるリスクがある。
        //       20s × 3回リトライ + 2s間隔 = 最大64秒だが2回目以降は高速成功するため実用的
        fetch: (url, options) =>
          fetch(url, { ...options, signal: AbortSignal.timeout(20_000) }),
      },
    })
  }
  return _admin
}
