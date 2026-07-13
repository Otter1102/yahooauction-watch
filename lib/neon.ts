import { neon, NeonQueryFunction } from '@neondatabase/serverless'

let _sql: NeonQueryFunction<false, false> | null = null

function connectionString(): string {
  return (process.env.NEON_DATABASE_URL ?? '').trim()
}

export function isNeonEnabled(): boolean {
  const mode = (process.env.HISTORY_STORE ?? 'auto').trim().toLowerCase()
  if (mode === 'supabase') return false
  return Boolean(connectionString())
}

export function historyStoreBackend(): 'neon' | 'supabase' {
  return isNeonEnabled() ? 'neon' : 'supabase'
}

export function getNeonSql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const url = connectionString()
    if (!url) throw new Error('[Neon] NEON_DATABASE_URL が未設定です')
    _sql = neon(url)
  }
  return _sql
}

export async function neonPing(): Promise<string> {
  const sql = getNeonSql()
  const rows = (await sql`SELECT 'pong'::text AS ok`) as Array<{ ok?: string }>
  return String(rows[0]?.ok ?? 'ok')
}

export function describeNeonError(error: unknown): string {
  if (!error) return 'unknown error'
  if (error instanceof Error) return `${error.name}: ${error.message}`
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
