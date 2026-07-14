import { getNeonSql } from './neon'
import type { SearchCondition } from './types'

function toCondition(row: Record<string, unknown>): SearchCondition {
  const created = row.created_at
  const lastChecked = row.last_checked_at
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    keyword: row.keyword as string,
    maxPrice: row.max_price as number,
    minPrice: (row.min_price as number) ?? 0,
    minBids: (row.min_bids as number) ?? 0,
    maxBids: (row.max_bids as number | null) ?? null,
    sellerType: (row.seller_type as SearchCondition['sellerType']) ?? 'all',
    itemCondition: (row.item_condition as SearchCondition['itemCondition']) ?? 'all',
    sortBy: (row.sort_by as SearchCondition['sortBy']) ?? 'endTime',
    sortOrder: (row.sort_order as SearchCondition['sortOrder']) ?? 'asc',
    buyItNow: row.buy_it_now === undefined ? null : (row.buy_it_now as boolean | null),
    enabled: row.enabled as boolean,
    createdAt: created instanceof Date ? (created as Date).toISOString() : (created as string),
    lastCheckedAt: lastChecked
      ? lastChecked instanceof Date
        ? (lastChecked as Date).toISOString()
        : (lastChecked as string)
      : undefined,
    lastFoundCount: (row.last_found_count as number | null) ?? undefined,
  }
}

export async function getConditions(userId: string): Promise<SearchCondition[]> {
  const sql = getNeonSql()
  const rows = (await sql`
    SELECT * FROM conditions
    WHERE user_id = ${userId}
    ORDER BY created_at ASC
  `) as Array<Record<string, unknown>>
  return rows.map(toCondition)
}

export async function getAllEnabledConditions(): Promise<SearchCondition[]> {
  const sql = getNeonSql()
  const rows = (await sql`
    SELECT * FROM conditions
    WHERE enabled = TRUE
    ORDER BY id ASC
  `) as Array<Record<string, unknown>>
  return rows.map(toCondition)
}

export async function getCondition(conditionId: string): Promise<SearchCondition | null> {
  const sql = getNeonSql()
  const rows = (await sql`
    SELECT * FROM conditions WHERE id = ${conditionId}::uuid LIMIT 1
  `) as Array<Record<string, unknown>>
  if (rows.length === 0) return null
  return toCondition(rows[0])
}

export async function verifyOwnership(conditionId: string, userId: string): Promise<boolean> {
  const sql = getNeonSql()
  const rows = (await sql`
    SELECT id FROM conditions
    WHERE id = ${conditionId}::uuid AND user_id = ${userId}
    LIMIT 1
  `) as Array<{ id: string }>
  return rows.length > 0
}

export async function createCondition(
  userId: string,
  input: Omit<SearchCondition, 'id' | 'userId' | 'createdAt'>,
): Promise<SearchCondition> {
  const sql = getNeonSql()
  const rows = (await sql`
    INSERT INTO conditions (
      user_id, name, keyword, max_price, min_price, min_bids, max_bids,
      seller_type, item_condition, sort_by, sort_order, buy_it_now, enabled
    ) VALUES (
      ${userId}, ${input.name}, ${input.keyword}, ${input.maxPrice},
      ${input.minPrice ?? 0}, ${input.minBids ?? 0}, ${input.maxBids ?? null},
      ${input.sellerType ?? 'all'}, ${input.itemCondition ?? 'all'},
      ${input.sortBy ?? 'endTime'}, ${input.sortOrder ?? 'asc'},
      ${input.buyItNow ?? null}, ${input.enabled ?? true}
    )
    RETURNING *
  `) as Array<Record<string, unknown>>
  if (rows.length === 0) throw new Error('[Neon] conditions 作成失敗: 結果なし')
  return toCondition(rows[0])
}

export async function updateCondition(
  conditionId: string,
  updates: Partial<SearchCondition>,
): Promise<void> {
  const sql = getNeonSql()
  // Neon serverless driver は tagged template で動的カラム構築が面倒なので個別UPDATEにする。
  // ヒットするカラムはユーザー操作か cron 側の巡回時刻更新に限られるので回数は少ない。
  if (updates.name !== undefined) {
    await sql`UPDATE conditions SET name = ${updates.name} WHERE id = ${conditionId}::uuid`
  }
  if (updates.keyword !== undefined) {
    await sql`UPDATE conditions SET keyword = ${updates.keyword} WHERE id = ${conditionId}::uuid`
  }
  if (updates.maxPrice !== undefined) {
    await sql`UPDATE conditions SET max_price = ${updates.maxPrice} WHERE id = ${conditionId}::uuid`
  }
  if (updates.minPrice !== undefined) {
    await sql`UPDATE conditions SET min_price = ${updates.minPrice} WHERE id = ${conditionId}::uuid`
  }
  if (updates.minBids !== undefined) {
    await sql`UPDATE conditions SET min_bids = ${updates.minBids} WHERE id = ${conditionId}::uuid`
  }
  if ('maxBids' in updates) {
    await sql`UPDATE conditions SET max_bids = ${updates.maxBids ?? null} WHERE id = ${conditionId}::uuid`
  }
  if (updates.sellerType !== undefined) {
    await sql`UPDATE conditions SET seller_type = ${updates.sellerType} WHERE id = ${conditionId}::uuid`
  }
  if (updates.itemCondition !== undefined) {
    await sql`UPDATE conditions SET item_condition = ${updates.itemCondition} WHERE id = ${conditionId}::uuid`
  }
  if (updates.sortBy !== undefined) {
    await sql`UPDATE conditions SET sort_by = ${updates.sortBy} WHERE id = ${conditionId}::uuid`
  }
  if (updates.sortOrder !== undefined) {
    await sql`UPDATE conditions SET sort_order = ${updates.sortOrder} WHERE id = ${conditionId}::uuid`
  }
  if (updates.buyItNow !== undefined) {
    await sql`UPDATE conditions SET buy_it_now = ${updates.buyItNow} WHERE id = ${conditionId}::uuid`
  }
  if (updates.enabled !== undefined) {
    await sql`UPDATE conditions SET enabled = ${updates.enabled} WHERE id = ${conditionId}::uuid`
  }
  if (updates.lastCheckedAt !== undefined) {
    await sql`UPDATE conditions SET last_checked_at = ${updates.lastCheckedAt} WHERE id = ${conditionId}::uuid`
  }
  if (updates.lastFoundCount !== undefined) {
    await sql`UPDATE conditions SET last_found_count = ${updates.lastFoundCount} WHERE id = ${conditionId}::uuid`
  }
}

export async function stampEnabledConditionsForUser(userId: string, checkedAt: string): Promise<number> {
  const sql = getNeonSql()
  const rows = (await sql`
    UPDATE conditions
    SET last_checked_at = ${checkedAt}
    WHERE user_id = ${userId} AND enabled = TRUE
    RETURNING id
  `) as Array<{ id: string }>
  return rows.length
}

export async function deleteCondition(conditionId: string): Promise<void> {
  const sql = getNeonSql()
  await sql`DELETE FROM conditions WHERE id = ${conditionId}::uuid`
}
