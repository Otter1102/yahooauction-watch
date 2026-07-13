import { getNeonSql } from './neon'
import { NotificationRecord, SearchCondition } from './types'

type HistoryInput = Omit<NotificationRecord, 'id'>

const CHECK_HISTORY_PREFIX = '__check_'
const ENDED_AUCTION_HISTORY_VISIBLE_MS = 24 * 60 * 60 * 1_000

const UPSERT_COLUMNS = [
  'user_id',
  'condition_id',
  'condition_name',
  'auction_id',
  'title',
  'price',
  'url',
  'image_url',
  'remaining',
  'end_at',
] as const

function isVisibleRow(row: Record<string, unknown>, now = Date.now()): boolean {
  const auctionId = String(row.auction_id ?? '')
  if (auctionId.startsWith(CHECK_HISTORY_PREFIX)) return true
  const endAt = row.end_at
  if (!endAt) return true
  const endMs = Date.parse(String(endAt))
  if (!Number.isFinite(endMs)) return true
  return endMs >= now - ENDED_AUCTION_HISTORY_VISIBLE_MS
}

function toRecord(row: Record<string, unknown>): NotificationRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    conditionId: row.condition_id as string,
    conditionName: row.condition_name as string,
    auctionId: row.auction_id as string,
    title: row.title as string,
    price: row.price as string,
    url: row.url as string,
    imageUrl: (row.image_url as string) ?? '',
    notifiedAt: row.notified_at instanceof Date
      ? (row.notified_at as Date).toISOString()
      : (row.notified_at as string),
    remaining: (row.remaining as string) ?? null,
    endAt: row.end_at instanceof Date
      ? (row.end_at as Date).toISOString()
      : ((row.end_at as string) ?? null),
    kind: String(row.auction_id ?? '').startsWith(CHECK_HISTORY_PREFIX) ? 'check' : 'auction',
  }
}

function historyValues(record: HistoryInput): unknown[] {
  return [
    record.userId,
    record.conditionId,
    record.conditionName,
    record.auctionId,
    record.title,
    record.price,
    record.url,
    record.imageUrl ?? null,
    record.remaining ?? null,
    record.endAt ?? null,
  ]
}

async function upsertOne(record: HistoryInput, refreshNotifiedAt: boolean): Promise<void> {
  const sql = getNeonSql()
  const existing = (await sql`
    SELECT id FROM notification_history
    WHERE user_id = ${record.userId}
      AND auction_id = ${record.auctionId}
    ORDER BY notified_at DESC
    LIMIT 20
  `) as Array<{ id: string }>

  if (existing.length > 0) {
    const keepId = existing[0].id
    if (refreshNotifiedAt) {
      await sql`
        UPDATE notification_history SET
          user_id = ${record.userId},
          condition_id = ${record.conditionId},
          condition_name = ${record.conditionName},
          auction_id = ${record.auctionId},
          title = ${record.title},
          price = ${record.price},
          url = ${record.url},
          image_url = ${record.imageUrl ?? null},
          remaining = ${record.remaining ?? null},
          end_at = ${record.endAt ?? null},
          notified_at = ${record.notifiedAt}
        WHERE id = ${keepId}
      `
    } else {
      await sql`
        UPDATE notification_history SET
          user_id = ${record.userId},
          condition_id = ${record.conditionId},
          condition_name = ${record.conditionName},
          auction_id = ${record.auctionId},
          title = ${record.title},
          price = ${record.price},
          url = ${record.url},
          image_url = ${record.imageUrl ?? null},
          remaining = ${record.remaining ?? null},
          end_at = ${record.endAt ?? null}
        WHERE id = ${keepId}
      `
    }

    if (existing.length > 1) {
      const dupIds = existing.slice(1).map(r => r.id)
      await sql`DELETE FROM notification_history WHERE id = ANY(${dupIds}::uuid[])`
    }
    return
  }

  await sql`
    INSERT INTO notification_history (
      user_id, condition_id, condition_name, auction_id,
      title, price, url, image_url, remaining, end_at, notified_at
    ) VALUES (
      ${record.userId}, ${record.conditionId}, ${record.conditionName}, ${record.auctionId},
      ${record.title}, ${record.price}, ${record.url}, ${record.imageUrl ?? null},
      ${record.remaining ?? null}, ${record.endAt ?? null}, ${record.notifiedAt}
    )
  `
}

async function upsertMany(records: HistoryInput[], refreshNotifiedAt: boolean): Promise<void> {
  const unique = new Map<string, HistoryInput>()
  for (const record of records) unique.set(`${record.userId}:${record.auctionId}`, record)
  const deduped = [...unique.values()]
  if (deduped.length === 0) return

  const sql = getNeonSql()
  const batchSize = Math.max(25, Number.parseInt(process.env.HISTORY_UPSERT_BATCH_SIZE ?? '100', 10) || 100)

  for (let i = 0; i < deduped.length; i += batchSize) {
    const batch = deduped.slice(i, i + batchSize)
    const params: unknown[] = []
    const valuesSql: string[] = []

    for (const record of batch) {
      const values = historyValues(record)
      const start = params.length + 1
      const placeholders: string[] = []
      for (let k = 0; k < values.length; k++) placeholders.push(`$${start + k}`)
      const notifiedIdx = start + values.length
      params.push(...values, record.notifiedAt)
      valuesSql.push(`(${placeholders.join(', ')}, $${notifiedIdx})`)
    }

    const columns = UPSERT_COLUMNS.join(', ') + ', notified_at'
    const setColumns: string[] = refreshNotifiedAt
      ? [...UPSERT_COLUMNS, 'notified_at']
      : [...UPSERT_COLUMNS]
    const setClause = setColumns.map(c => `${c} = EXCLUDED.${c}`).join(', ')

    const query =
      `INSERT INTO notification_history (${columns}) VALUES ${valuesSql.join(', ')} ` +
      `ON CONFLICT (user_id, auction_id) WHERE auction_id IS NOT NULL DO UPDATE SET ${setClause}`

    try {
      await sql.query(query, params)
    } catch (err) {
      // 部分ユニーク索引が未作成の環境向けフォールバック
      console.warn('[neon-history] batch upsert失敗、逐次経路へフォールバック:', err instanceof Error ? err.message : err)
      for (const record of batch) {
        await upsertOne(record, refreshNotifiedAt)
      }
    }
  }
}

export async function addHistory(record: HistoryInput): Promise<void> {
  await upsertOne(record, true)
}

export async function addHistories(records: HistoryInput[]): Promise<void> {
  await upsertMany(records, true)
}

export async function updateHistorySnapshot(record: HistoryInput): Promise<void> {
  await upsertOne(record, false)
}

export async function updateHistorySnapshots(records: HistoryInput[]): Promise<void> {
  await upsertMany(records, false)
}

export async function addConditionCheckHistory(
  condition: SearchCondition,
  result: { status: 'ok' | 'failed'; matchedCount?: number; freshCount?: number }
): Promise<void> {
  const now = new Date()
  const hourKey = now.toISOString().slice(0, 13)
  const freshCount = result.freshCount ?? 0
  const matchedCount = result.matchedCount ?? 0
  const title = result.status === 'failed'
    ? '条件チェック: 警告・取得エラー'
    : freshCount > 0
      ? `条件チェック: 新着${freshCount}件を確認しました`
      : '条件チェック: 取得完了・新着はありませんでした'
  const remaining = result.status === 'failed'
    ? '要確認'
    : `該当${matchedCount}件`

  await upsertOne({
    userId: condition.userId,
    conditionId: condition.id,
    conditionName: condition.name,
    auctionId: `${CHECK_HISTORY_PREFIX}${condition.id}_${hourKey}`,
    title,
    price: result.status === 'failed' ? '取得エラー' : freshCount > 0 ? `新着${freshCount}件` : '取得OK・新着なし',
    url: '/history',
    imageUrl: '',
    notifiedAt: now.toISOString(),
    remaining,
    endAt: null,
    kind: 'check',
  }, true)
}

export async function getHistory(userId: string, limit = 500): Promise<NotificationRecord[]> {
  const sql = getNeonSql()
  const fetchLimit = Math.max(limit * 2, 1000)
  const rows = (await sql`
    SELECT * FROM notification_history
    WHERE user_id = ${userId}
    ORDER BY notified_at DESC
    LIMIT ${fetchLimit}
  `) as Array<Record<string, unknown>>

  const seen = new Set<string>()
  return rows
    .filter(r => {
      if (!isVisibleRow(r)) return false
      const auctionId = r.auction_id as string
      if (!auctionId) return true
      if (seen.has(auctionId)) return false
      seen.add(auctionId)
      return true
    })
    .slice(0, limit)
    .map(toRecord)
}

export async function cleanupOldHistory(): Promise<void> {
  const sql = getNeonSql()
  const checkRetentionHours = Math.max(6, Number.parseInt(process.env.CHECK_HISTORY_RETENTION_HOURS ?? '36', 10) || 36)
  const unknownRetentionHours = Math.max(24, Number.parseInt(process.env.UNKNOWN_END_HISTORY_RETENTION_HOURS ?? '72', 10) || 72)
  const now = Date.now()
  const endedCutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString()
  const checkCutoff = new Date(now - checkRetentionHours * 60 * 60 * 1000).toISOString()
  const unknownEndCutoff = new Date(now - unknownRetentionHours * 60 * 60 * 1000).toISOString()

  await sql`
    DELETE FROM notification_history
    WHERE auction_id LIKE ${CHECK_HISTORY_PREFIX + '%'}
      AND notified_at < ${checkCutoff}
  `

  await sql`
    DELETE FROM notification_history
    WHERE auction_id NOT LIKE ${CHECK_HISTORY_PREFIX + '%'}
      AND end_at IS NOT NULL
      AND end_at < ${endedCutoff}
  `

  await sql`
    DELETE FROM notification_history
    WHERE auction_id NOT LIKE ${CHECK_HISTORY_PREFIX + '%'}
      AND end_at IS NULL
      AND notified_at < ${unknownEndCutoff}
  `
}

export async function cleanupEndedHistoryForUser(userId: string): Promise<number> {
  const sql = getNeonSql()
  const cutoff = new Date(Date.now() - ENDED_AUCTION_HISTORY_VISIBLE_MS).toISOString()
  const rows = (await sql`
    DELETE FROM notification_history
    WHERE user_id = ${userId}
      AND auction_id NOT LIKE ${CHECK_HISTORY_PREFIX + '%'}
      AND end_at IS NOT NULL
      AND end_at < ${cutoff}
    RETURNING id
  `) as Array<{ id: string }>
  return rows.length
}

// resetStalledNotified 用: 直近 cutoff 以降に auction 通知が発火したユーザーIDを返す
export async function getRecentActiveUserIds(cutoffIso: string): Promise<Set<string>> {
  const sql = getNeonSql()
  const rows = (await sql`
    SELECT DISTINCT user_id FROM notification_history
    WHERE notified_at >= ${cutoffIso}
      AND auction_id IS NOT NULL
      AND auction_id NOT LIKE ${CHECK_HISTORY_PREFIX + '%'}
  `) as Array<{ user_id: string }>
  return new Set(rows.map(r => r.user_id))
}
