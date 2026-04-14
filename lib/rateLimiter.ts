/**
 * シンプルなインメモリレートリミッター
 * 同一 Vercel インスタンス内で有効。冷却後リセットされるが基本的な乱用防止として十分。
 */
const store = new Map<string, { count: number; resetAt: number }>()

/** true = 許可, false = レート超過 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): boolean {
  // メモリリーク防止: エントリが多すぎたら期限切れを掃除
  if (store.size > 5000) {
    const now = Date.now()
    for (const [k, v] of store) {
      if (now > v.resetAt) store.delete(k)
    }
  }

  const now = Date.now()
  const entry = store.get(key)
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (entry.count >= maxRequests) return false
  entry.count++
  return true
}
