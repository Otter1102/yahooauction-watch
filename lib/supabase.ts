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
    const timeoutMs = Math.max(5_000, Number.parseInt(process.env.SUPABASE_FETCH_TIMEOUT_MS ?? '20000', 10) || 20_000)
    _admin = createClient(url, key, {
      global: {
        // GitHub Actions cron は Supabase の一時遅延で失敗しないよう環境変数で長めにできる。
        fetch: (url, options) =>
          fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) }),
      },
    })
  }
  return _admin
}
