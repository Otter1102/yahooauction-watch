type RedisValue = string | number
type UpstashResult<T> = { result?: T; error?: string }

const DEFAULT_PREFIX = 'notified:v1'

function redisUrl(): string {
  return (process.env.UPSTASH_REDIS_REST_URL ?? '').trim().replace(/\/+$/, '')
}

function redisToken(): string {
  return (process.env.UPSTASH_REDIS_REST_TOKEN ?? '').trim()
}

export function isUpstashNotifiedEnabled(): boolean {
  const mode = (process.env.NOTIFIED_ITEMS_STORE ?? 'auto').trim().toLowerCase()
  if (mode === 'supabase') return false
  return Boolean(redisUrl() && redisToken())
}

export function notifiedItemsStoreName(): 'upstash' | 'supabase' {
  return isUpstashNotifiedEnabled() ? 'upstash' : 'supabase'
}

function prefix(): string {
  return (process.env.NOTIFIED_REDIS_PREFIX ?? DEFAULT_PREFIX).trim() || DEFAULT_PREFIX
}

function userKey(userId: string): string {
  return `${prefix()}:user:${userId}`
}

function retentionHours(): number {
  return Math.max(24, Number.parseInt(process.env.NOTIFIED_RETENTION_HOURS ?? '60', 10) || 60)
}

function retentionSeconds(): number {
  return retentionHours() * 60 * 60
}

function cutoffScore(): number {
  return Date.now() - retentionHours() * 60 * 60 * 1000
}

async function redisCommand<T>(command: RedisValue[]): Promise<T> {
  const url = redisUrl()
  const token = redisToken()
  if (!url || !token) throw new Error('[Upstash] Redis環境変数が未設定です')

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  })
  const text = await res.text()
  let json: UpstashResult<T>
  try {
    json = JSON.parse(text) as UpstashResult<T>
  } catch {
    throw new Error(`[Upstash] ${command[0]} JSON解析失敗: HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  if (!res.ok || json.error) {
    throw new Error(`[Upstash] ${command[0]} 失敗: HTTP ${res.status} ${json.error ?? text.slice(0, 200)}`)
  }
  return json.result as T
}

async function redisPipeline<T = unknown>(commands: RedisValue[][]): Promise<UpstashResult<T>[]> {
  if (commands.length === 0) return []
  const url = redisUrl()
  const token = redisToken()
  if (!url || !token) throw new Error('[Upstash] Redis環境変数が未設定です')

  const res = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  })
  const text = await res.text()
  let json: UpstashResult<T>[]
  try {
    json = JSON.parse(text) as UpstashResult<T>[]
  } catch {
    throw new Error(`[Upstash] pipeline JSON解析失敗: HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  if (!res.ok) {
    throw new Error(`[Upstash] pipeline 失敗: HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  const failed = json.find(r => r.error)
  if (failed) throw new Error(`[Upstash] pipeline コマンド失敗: ${failed.error}`)
  return json
}

export async function upstashPing(): Promise<string> {
  return String(await redisCommand<string>(['PING']))
}

export async function upstashIsNotified(userId: string, auctionId: string): Promise<boolean> {
  const result = await redisCommand<string | null>(['ZSCORE', userKey(userId), auctionId])
  return result !== null && result !== undefined
}

export async function upstashMarkNotified(userId: string, auctionId: string): Promise<void> {
  await upstashMarkNotifiedMany(userId, [auctionId])
}

export async function upstashReserveNotifiedId(userId: string, auctionId: string): Promise<boolean> {
  const key = userKey(userId)
  const now = Date.now()
  const results = await redisPipeline<number | string>([
    ['ZREMRANGEBYSCORE', key, '-inf', cutoffScore()],
    ['ZADD', key, 'NX', now, auctionId],
    ['EXPIRE', key, retentionSeconds()],
  ])
  return Number(results[1]?.result ?? 0) > 0
}

export async function upstashReleaseNotifiedId(userId: string, auctionId: string): Promise<void> {
  await redisCommand<number>(['ZREM', userKey(userId), auctionId])
}

export async function upstashMarkNotifiedMany(userId: string, auctionIds: string[]): Promise<void> {
  const unique = [...new Set(auctionIds)].filter(Boolean)
  if (unique.length === 0) return

  const batchSize = Math.max(50, Number.parseInt(process.env.NOTIFIED_UPSERT_BATCH_SIZE ?? '200', 10) || 200)
  const key = userKey(userId)
  const now = Date.now()

  for (let i = 0; i < unique.length; i += batchSize) {
    const args: RedisValue[] = ['ZADD', key]
    for (const auctionId of unique.slice(i, i + batchSize)) {
      args.push(now, auctionId)
    }
    await redisPipeline([
      ['ZREMRANGEBYSCORE', key, '-inf', cutoffScore()],
      args,
      ['EXPIRE', key, retentionSeconds()],
    ])
  }
}

export async function upstashGetNotifiedIds(userId: string): Promise<Set<string>> {
  const results = await redisPipeline<string[]>([
    ['ZREMRANGEBYSCORE', userKey(userId), '-inf', cutoffScore()],
    ['ZRANGE', userKey(userId), 0, -1],
  ])
  const ids = Array.isArray(results[1]?.result) ? results[1].result : []
  return new Set(ids.map(String))
}

export async function upstashGetAllNotifiedIds(userIds: string[]): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>()
  const uniqueUserIds = [...new Set(userIds)]
  for (const userId of uniqueUserIds) map.set(userId, new Set())
  if (uniqueUserIds.length === 0) return map

  const usersPerBatch = Math.max(10, Number.parseInt(process.env.NOTIFIED_REDIS_READ_USERS_PER_BATCH ?? '100', 10) || 100)
  for (let i = 0; i < uniqueUserIds.length; i += usersPerBatch) {
    const batch = uniqueUserIds.slice(i, i + usersPerBatch)
    const commands: RedisValue[][] = []
    for (const userId of batch) {
      commands.push(['ZREMRANGEBYSCORE', userKey(userId), '-inf', cutoffScore()])
      commands.push(['ZRANGE', userKey(userId), 0, -1])
    }
    const results = await redisPipeline<string[]>(commands)
    for (let j = 0; j < batch.length; j++) {
      const result = results[j * 2 + 1]?.result
      const ids = Array.isArray(result) ? result : []
      map.set(batch[j], new Set(ids.map(String)))
    }
  }
  return map
}

export async function upstashClearNotifiedHistory(userId: string): Promise<void> {
  await redisCommand<number>(['DEL', userKey(userId)])
}

export async function upstashCountNotifiedItems(): Promise<number> {
  let cursor = '0'
  let total = 0
  do {
    const result = await redisCommand<[string, string[]]>(['SCAN', cursor, 'MATCH', `${prefix()}:user:*`, 'COUNT', 100])
    cursor = String(result[0] ?? '0')
    const keys = Array.isArray(result[1]) ? result[1] : []
    if (keys.length > 0) {
      const counts = await redisPipeline<number>(keys.map(key => ['ZCARD', key]))
      total += counts.reduce((sum, r) => sum + Number(r.result ?? 0), 0)
    }
  } while (cursor !== '0')
  return total
}

export async function upstashClearAllNotifiedItems(): Promise<number> {
  let cursor = '0'
  let deleted = 0
  do {
    const result = await redisCommand<[string, string[]]>(['SCAN', cursor, 'MATCH', `${prefix()}:user:*`, 'COUNT', 100])
    cursor = String(result[0] ?? '0')
    const keys = Array.isArray(result[1]) ? result[1] : []
    if (keys.length > 0) {
      const results = await redisPipeline<number>(keys.map(key => ['DEL', key]))
      deleted += results.reduce((sum, r) => sum + Number(r.result ?? 0), 0)
    }
  } while (cursor !== '0')
  return deleted
}
