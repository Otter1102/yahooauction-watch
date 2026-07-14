/**
 * Supabase ストレージ層
 * フロントエンドからはAPI routes経由で呼ぶ
 * GitHub Actionsスクリプトからは直接 supabaseAdmin を使う
 */
import { describeSupabaseError, getSupabaseAdmin } from './supabase'
const supabaseAdmin = { from: (...args: Parameters<ReturnType<typeof getSupabaseAdmin>['from']>) => getSupabaseAdmin().from(...args) }
import { SearchCondition, User, NotificationRecord, PushSub } from './types'
import {
  isUpstashNotifiedEnabled,
  notifiedItemsStoreName,
  upstashClearNotifiedHistory,
  upstashGetAllNotifiedIds,
  upstashGetNotifiedIds,
  upstashIsNotified,
  upstashMarkNotified,
  upstashMarkNotifiedMany,
  upstashReleaseNotifiedId,
  upstashReserveNotifiedId,
} from './notified-store'
import { isNeonEnabled, historyStoreBackend } from './neon'
import * as neonHistory from './neon-history'
import * as neonUsers from './neon-users'
import * as neonConditions from './neon-conditions'

export function getHistoryStoreBackend(): 'neon' | 'supabase' {
  return historyStoreBackend()
}

const CONDITION_COLUMNS = [
  'id',
  'user_id',
  'name',
  'keyword',
  'max_price',
  'min_price',
  'min_bids',
  'max_bids',
  'seller_type',
  'item_condition',
  'sort_by',
  'sort_order',
  'buy_it_now',
  'enabled',
  'created_at',
  'last_checked_at',
  'last_found_count',
].join(',')

function throwOnError(error: unknown, context: string): void {
  if (error) throw new Error(`[Supabase] ${context}: ${describeSupabaseError(error)}`)
}

export function isSupabaseUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /TimeoutError|operation was aborted|fetch failed|network|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|Cloudflare|HTTP 000|522|503|504|Invalid API key/i.test(message)
}

export const SUPABASE_UNAVAILABLE_MESSAGE =
  '現在サーバーの保存先DBに接続できません。条件は保存されていません。数分後にもう一度お試しください。'

// ==================== Users ====================

export async function userExists(userId: string): Promise<boolean> {
  if (isNeonEnabled()) return neonUsers.userExists(userId)
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('id', userId)
    .single()
  if (error && error.code !== 'PGRST116') throwOnError(error, 'users存在確認エラー')
  return !!data
}

export async function getOrCreateUser(userId: string): Promise<User> {
  if (isNeonEnabled()) return neonUsers.getOrCreateUser(userId)
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  if (data) return dbToUser(data)
  if (error && error.code !== 'PGRST116') throwOnError(error, 'users取得エラー')

  const { data: created, error: createError } = await supabaseAdmin
    .from('users')
    .insert({ id: userId })
    .select()
    .single()
  throwOnError(createError, 'users作成エラー')
  if (!created) throw new Error('[Supabase] users作成エラー: 作成結果が空です')

  return dbToUser(created)
}

export async function getUser(userId: string): Promise<User | null> {
  if (isNeonEnabled()) return neonUsers.getUser(userId)
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, push_sub')
    .eq('id', userId)
    .single()
  if (!data) return null
  return dbToUser(data)
}

export async function updateUser(userId: string, updates: Partial<User>): Promise<void> {
  if (isNeonEnabled()) {
    if ('pushSub' in updates) {
      await neonUsers.setPushSub(userId, updates.pushSub ?? null)
    }
    return
  }
  const row: Record<string, unknown> = {}
  if ('pushSub' in updates) row.push_sub = updates.pushSub ?? null
  await supabaseAdmin.from('users').update(row).eq('id', userId)
}

export async function getUsersWithPush(userIds: string[]): Promise<Map<string, PushSub>> {
  if (isNeonEnabled()) return neonUsers.getUsersWithPush(userIds)
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, push_sub')
    .in('id', userIds)
    .not('push_sub', 'is', null)
  const map = new Map<string, PushSub>()
  for (const row of data ?? []) {
    if (row.push_sub) map.set(row.id as string, row.push_sub as PushSub)
  }
  return map
}

export async function getUsersMap(userIds: string[]): Promise<Map<string, User>> {
  if (isNeonEnabled()) return neonUsers.getUsersMap(userIds)
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, push_sub')
    .in('id', userIds)
  const map = new Map<string, User>()
  for (const row of data ?? []) map.set(row.id as string, dbToUser(row))
  return map
}

export async function getAllPushEnabledUserIds(): Promise<string[]> {
  if (isNeonEnabled()) return neonUsers.getAllPushEnabledUserIds()
  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .not('push_sub', 'is', null)
  return (data ?? []).map(r => r.id as string)
}

export async function getPushSub(userId: string): Promise<PushSub | null> {
  if (isNeonEnabled()) return neonUsers.getPushSub(userId)
  const { data } = await supabaseAdmin
    .from('users')
    .select('push_sub')
    .eq('id', userId)
    .single()
  return (data?.push_sub as PushSub | null) ?? null
}

export async function clearPushSub(userId: string): Promise<void> {
  if (isNeonEnabled()) {
    await neonUsers.clearPushSub(userId)
    return
  }
  await supabaseAdmin.from('users').update({ push_sub: null }).eq('id', userId)
}

export async function setDeviceFingerprint(
  userId: string,
  deviceFingerprint: string,
  isTrial: boolean,
): Promise<void> {
  if (isNeonEnabled()) {
    await neonUsers.setDeviceFingerprint(userId, deviceFingerprint, isTrial)
    return
  }
  await supabaseAdmin
    .from('users')
    .update({ device_fingerprint: deviceFingerprint, is_trial: isTrial })
    .eq('id', userId)
}

export async function clearPushSubForDuplicateDevice(
  deviceFingerprint: string,
  keepUserId: string,
): Promise<string[]> {
  if (isNeonEnabled()) return neonUsers.clearPushSubForDuplicateDevice(deviceFingerprint, keepUserId)
  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('device_fingerprint', deviceFingerprint)
    .neq('id', keepUserId)
  const ids = (data ?? []).map(r => r.id as string)
  if (ids.length > 0) {
    await supabaseAdmin.from('users').update({ push_sub: null }).in('id', ids)
  }
  return ids
}

export async function cleanupGhostUsers(cutoffIso: string): Promise<number> {
  if (isNeonEnabled()) return neonUsers.cleanupGhostUsers(cutoffIso)
  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .is('push_sub', null)
    .lt('created_at', cutoffIso)
  const ids = (data ?? []).map(r => r.id as string)
  if (ids.length === 0) return 0
  await supabaseAdmin.from('users').delete().in('id', ids)
  return ids.length
}

function dbToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    ntfyTopic: '',
    discordWebhook: '',
    notificationChannel: 'webpush',
    pushSub: (row.push_sub as PushSub) ?? null,
  }
}

// ==================== Conditions ====================

export async function getConditions(userId: string): Promise<SearchCondition[]> {
  if (isNeonEnabled()) return neonConditions.getConditions(userId)
  const { data, error } = await supabaseAdmin
    .from('conditions')
    .select(CONDITION_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  throwOnError(error, 'conditions取得エラー')
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(dbToCondition)
}

export async function getAllEnabledConditions(): Promise<SearchCondition[]> {
  if (isNeonEnabled()) return neonConditions.getAllEnabledConditions()
  const pageSize = 200
  const rows: Record<string, unknown>[] = []

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('conditions')
      .select(CONDITION_COLUMNS)
      .eq('enabled', true)
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`[Supabase] conditions取得エラー: ${error.message} (code=${error.code})`)

    const batch = (data ?? []) as unknown as Record<string, unknown>[]
    rows.push(...batch)
    if (batch.length < pageSize) break
  }

  return rows.map(dbToCondition)
}

export async function verifyConditionOwnership(conditionId: string, userId: string): Promise<boolean> {
  if (isNeonEnabled()) return neonConditions.verifyOwnership(conditionId, userId)
  const { data } = await supabaseAdmin
    .from('conditions')
    .select('id')
    .eq('id', conditionId)
    .eq('user_id', userId)
    .single()
  return !!data
}

export async function createCondition(
  userId: string,
  input: Omit<SearchCondition, 'id' | 'userId' | 'createdAt'>
): Promise<SearchCondition> {
  if (isNeonEnabled()) return neonConditions.createCondition(userId, input)
  // max_bids は migration_005 で追加。null の場合はカラムを省略し
  // migration未実行環境でも既存カラムへの INSERT が失敗しないようにする
  const insertRow: Record<string, unknown> = {
    user_id: userId,
    name: input.name,
    keyword: input.keyword,
    max_price: input.maxPrice,
    min_price: input.minPrice ?? 0,
    min_bids: input.minBids ?? 0,
    seller_type: input.sellerType ?? 'all',
    item_condition: input.itemCondition ?? 'all',
    sort_by: input.sortBy ?? 'endTime',
    sort_order: input.sortOrder ?? 'asc',
    buy_it_now: input.buyItNow,
    enabled: input.enabled ?? true,
  }
  if (input.maxBids !== null && input.maxBids !== undefined) {
    insertRow.max_bids = input.maxBids
  }

  const { data, error } = await supabaseAdmin
    .from('conditions')
    .insert(insertRow)
    .select()
    .single()
  if (error || !data) throw new Error(error?.message ?? '条件の作成に失敗しました')
  return dbToCondition(data)
}

export async function updateCondition(
  conditionId: string,
  updates: Partial<SearchCondition>
): Promise<void> {
  if (isNeonEnabled()) return neonConditions.updateCondition(conditionId, updates)
  const row: Record<string, unknown> = {}
  if (updates.name !== undefined) row.name = updates.name
  if (updates.keyword !== undefined) row.keyword = updates.keyword
  if (updates.maxPrice !== undefined) row.max_price = updates.maxPrice
  if (updates.minPrice !== undefined) row.min_price = updates.minPrice
  if (updates.minBids !== undefined) row.min_bids = updates.minBids
  if ('maxBids' in updates) row.max_bids = updates.maxBids ?? null
  if (updates.sellerType !== undefined) row.seller_type = updates.sellerType
  if (updates.itemCondition !== undefined) row.item_condition = updates.itemCondition
  if (updates.sortBy !== undefined) row.sort_by = updates.sortBy
  if (updates.sortOrder !== undefined) row.sort_order = updates.sortOrder
  if (updates.buyItNow !== undefined) row.buy_it_now = updates.buyItNow
  if (updates.enabled !== undefined) row.enabled = updates.enabled
  if (updates.lastCheckedAt !== undefined) row.last_checked_at = updates.lastCheckedAt
  if (updates.lastFoundCount !== undefined) row.last_found_count = updates.lastFoundCount
  await supabaseAdmin.from('conditions').update(row).eq('id', conditionId)
}

export async function stampEnabledConditionsForUser(userId: string, checkedAt: string): Promise<number> {
  if (isNeonEnabled()) return neonConditions.stampEnabledConditionsForUser(userId, checkedAt)
  const { data, error } = await supabaseAdmin
    .from('conditions')
    .update({ last_checked_at: checkedAt })
    .eq('user_id', userId)
    .eq('enabled', true)
    .select('id')
  throwOnError(error, 'conditions起動時チェック時刻更新エラー')
  return data?.length ?? 0
}

export async function deleteCondition(conditionId: string): Promise<void> {
  if (isNeonEnabled()) return neonConditions.deleteCondition(conditionId)
  await supabaseAdmin.from('conditions').delete().eq('id', conditionId)
}

function dbToCondition(row: Record<string, unknown>): SearchCondition {
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
    createdAt: row.created_at as string,
    lastCheckedAt: row.last_checked_at as string | undefined,
    lastFoundCount: row.last_found_count as number | undefined,
  }
}

// ==================== Notified Items ====================

export function getNotifiedItemsStoreName(): 'upstash' | 'supabase' {
  return notifiedItemsStoreName()
}

export async function isNotified(userId: string, auctionId: string): Promise<boolean> {
  if (isUpstashNotifiedEnabled()) {
    return upstashIsNotified(userId, auctionId)
  }
  const { data } = await supabaseAdmin
    .from('notified_items')
    .select('auction_id')
    .eq('user_id', userId)
    .eq('auction_id', auctionId)
    .single()
  return !!data
}

export async function markNotified(userId: string, auctionId: string): Promise<void> {
  if (isUpstashNotifiedEnabled()) {
    await upstashMarkNotified(userId, auctionId)
    return
  }
  const { error } = await supabaseAdmin
    .from('notified_items')
    .upsert({ user_id: userId, auction_id: auctionId })
  throwOnError(error, 'notified_items保存エラー')
}

export async function markNotifiedMany(userId: string, auctionIds: string[]): Promise<void> {
  if (isUpstashNotifiedEnabled()) {
    await upstashMarkNotifiedMany(userId, auctionIds)
    return
  }
  const rows = [...new Set(auctionIds)].map(auctionId => ({ user_id: userId, auction_id: auctionId }))
  if (rows.length === 0) return
  const batchSize = Math.max(50, Number.parseInt(process.env.NOTIFIED_UPSERT_BATCH_SIZE ?? '200', 10) || 200)
  for (let i = 0; i < rows.length; i += batchSize) {
    const { error } = await supabaseAdmin
      .from('notified_items')
      .upsert(rows.slice(i, i + batchSize), { onConflict: 'user_id,auction_id', ignoreDuplicates: true })
    throwOnError(error, 'notified_items一括保存エラー')
  }
}

export async function getNotifiedIds(userId: string): Promise<Set<string>> {
  if (isUpstashNotifiedEnabled()) {
    return upstashGetNotifiedIds(userId)
  }
  const { data, error } = await supabaseAdmin
    .from('notified_items')
    .select('auction_id')
    .eq('user_id', userId)
  throwOnError(error, 'notified_items取得エラー')
  return new Set((data ?? []).map(r => r.auction_id as string))
}

// 複数ユーザーの通知済みIDを1クエリで一括取得
// 100ユーザーでも getNotifiedIds を100回呼ぶ代わりに1回で済む
export async function getAllNotifiedIds(userIds: string[]): Promise<Map<string, Set<string>>> {
  if (userIds.length === 0) return new Map()
  if (isUpstashNotifiedEnabled()) {
    return upstashGetAllNotifiedIds(userIds)
  }
  const { data, error } = await supabaseAdmin
    .from('notified_items')
    .select('user_id, auction_id')
    .in('user_id', userIds)
  throwOnError(error, 'notified_items一括取得エラー')
  const map = new Map<string, Set<string>>()
  for (const userId of userIds) map.set(userId, new Set())
  for (const row of data ?? []) {
    map.get(row.user_id as string)?.add(row.auction_id as string)
  }
  return map
}

export async function clearNotifiedHistory(userId: string): Promise<void> {
  if (isUpstashNotifiedEnabled()) {
    await upstashClearNotifiedHistory(userId)
    return
  }
  const { error } = await supabaseAdmin.from('notified_items').delete().eq('user_id', userId)
  throwOnError(error, 'notified_items削除エラー')
}

export async function reserveNotifiedItem(userId: string, auctionId: string): Promise<boolean> {
  if (isUpstashNotifiedEnabled()) {
    return upstashReserveNotifiedId(userId, auctionId)
  }
  const { error } = await supabaseAdmin
    .from('notified_items')
    .insert({ user_id: userId, auction_id: auctionId })
  if (!error) return true
  if ('code' in error && error.code === '23505') return false
  console.warn(`  ⚠️ [${userId.slice(0,8)}] notified_items予約失敗:`, error.message)
  return false
}

export async function releaseNotifiedItemReservation(userId: string, auctionId: string): Promise<void> {
  if (isUpstashNotifiedEnabled()) {
    await upstashReleaseNotifiedId(userId, auctionId)
    return
  }
  const { error } = await supabaseAdmin
    .from('notified_items')
    .delete()
    .eq('user_id', userId)
    .eq('auction_id', auctionId)
  if (error) {
    console.warn(`  ⚠️ [${userId.slice(0,8)}] notified_items予約解除失敗:`, error.message)
  }
}

export async function cleanupOldNotified(): Promise<void> {
  if (isUpstashNotifiedEnabled()) {
    console.log('[cleanup] notified_items はUpstash Redis TTL/ZREMRANGEBYSCOREで整理')
    return
  }
  const retentionHours = Math.max(24, Number.parseInt(process.env.NOTIFIED_RETENTION_HOURS ?? '60', 10) || 60)
  // 古い重複防止レコードを削除
  // 根拠: 通知対象は「残り48時間以内」のオークション → 終了まで最大48h。
  //       終了後の表示猶予を含めても、長期保持はDBを圧迫するためTTLで削除する。
  const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000).toISOString()
  const { error } = await supabaseAdmin
    .from('notified_items')
    .delete()
    .lt('notified_at', cutoff)
  throwOnError(error, '古いnotified_items削除エラー')
}

export async function resetStalledNotified(): Promise<string[]> {
  if (isUpstashNotifiedEnabled()) {
    console.log('[自己修復] notified_items はUpstash Redisへ移行済みのためSupabase集計リセットをスキップ')
    return []
  }
  if (process.env.ENABLE_STALLED_NOTIFIED_RESET !== 'true') {
    console.log('[自己修復] resetStalledNotified はDB負荷軽減のため停止中')
    return []
  }

  // 自己修復: 48時間以上通知が届いていないのに notified_items が溜まっているユーザーを検出し、
  //           通知済みリストを強制リセット（次のcronで再通知を開始させる）
  const supabase = getSupabaseAdmin()
  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  // 48時間以内に auction 通知が発火したユーザーIDを取得（Neon 有効時は Neon から）
  let recentSet: Set<string>
  if (isNeonEnabled()) {
    recentSet = await neonHistory.getRecentActiveUserIds(cutoff48h)
  } else {
    const { data: recentUsers, error: recentErr } = await supabase
      .from('notification_history')
      .select('user_id')
      .not('auction_id', 'like', '__check_%')
      .gte('notified_at', cutoff48h)
    throwOnError(recentErr, '直近通知履歴取得エラー')
    recentSet = new Set((recentUsers ?? []).map(r => r.user_id as string))
  }

  // push_sub を持つ全ユーザーを取得し、各ユーザーの notified_items 件数を count で確認
  // limit(500) では多数のユーザー/商品がいる場合にサイレントに見落とすため、
  // ユーザーごとに count クエリを発行する方式に変更
  const { data: pushUsers, error: pushErr } = await supabase
    .from('users')
    .select('id')
    .not('push_sub', 'is', null)
  throwOnError(pushErr, 'push_subユーザー取得エラー')

  const counts: Record<string, number> = {}
  await Promise.all(
    (pushUsers ?? []).map(async (u) => {
      const { count, error } = await supabase
        .from('notified_items')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', u.id)
      throwOnError(error, 'ユーザー別notified_items件数取得エラー')
      if ((count ?? 0) >= 20) counts[u.id] = count!
    })
  )

  // 条件: 48時間通知なし かつ notified_items が20件以上 → ブロックされている可能性大
  const stalledUsers = Object.entries(counts)
    .filter(([uid]) => !recentSet.has(uid))
    .map(([uid]) => uid)

  for (const uid of stalledUsers) {
    const { error } = await supabase.from('notified_items').delete().eq('user_id', uid)
    throwOnError(error, '停滞ユーザーnotified_itemsリセットエラー')
    console.log(`[自己修復] userId=${uid.slice(0,8)}... の notified_items をリセット (${counts[uid]}件削除)`)
  }

  return stalledUsers
}

export async function cleanupOldHistory(): Promise<void> {
  if (isNeonEnabled()) return neonHistory.cleanupOldHistory()
  const checkRetentionHours = Math.max(6, Number.parseInt(process.env.CHECK_HISTORY_RETENTION_HOURS ?? '36', 10) || 36)
  const unknownRetentionHours = Math.max(24, Number.parseInt(process.env.UNKNOWN_END_HISTORY_RETENTION_HOURS ?? '72', 10) || 72)
  const now = Date.now()
  const endedCutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString()
  const checkCutoff = new Date(now - checkRetentionHours * 60 * 60 * 1000).toISOString()
  const unknownEndCutoff = new Date(now - unknownRetentionHours * 60 * 60 * 1000).toISOString()

  // 条件チェック履歴は「巡回している証跡」なので短期保持で十分。
  const { error: checkErr } = await supabaseAdmin
    .from('notification_history')
    .delete()
    .like('auction_id', `${CHECK_HISTORY_PREFIX}%`)
    .lt('notified_at', checkCutoff)
  throwOnError(checkErr, '古い条件チェック履歴削除エラー')

  // 終了済みオークションは終了後24時間を超えたらDBから削除する。
  const { error: endedErr } = await supabaseAdmin
    .from('notification_history')
    .delete()
    .not('auction_id', 'like', `${CHECK_HISTORY_PREFIX}%`)
    .not('end_at', 'is', null)
    .lt('end_at', endedCutoff)
  throwOnError(endedErr, '終了24時間超の通知履歴削除エラー')

  // end_at が無い旧レコードは開催中判定ができないため、短期だけ残して削除する。
  const { error: unknownErr } = await supabaseAdmin
    .from('notification_history')
    .delete()
    .not('auction_id', 'like', `${CHECK_HISTORY_PREFIX}%`)
    .is('end_at', null)
    .lt('notified_at', unknownEndCutoff)
  throwOnError(unknownErr, 'end_atなし旧通知履歴削除エラー')
}

// ==================== History ====================

type HistoryInput = Omit<NotificationRecord, 'id'>
const CHECK_HISTORY_PREFIX = '__check_'
const ENDED_AUCTION_HISTORY_VISIBLE_MS = 24 * 60 * 60 * 1_000

function isVisibleHistoryRow(row: Record<string, unknown>, now = Date.now()): boolean {
  const auctionId = String(row.auction_id ?? '')
  if (auctionId.startsWith(CHECK_HISTORY_PREFIX)) return true
  const endAt = row.end_at
  if (!endAt) return true
  const endMs = Date.parse(String(endAt))
  if (!Number.isFinite(endMs)) return true
  // 開催中、または終了後24時間以内だけ表示。DBからは削除しない。
  return endMs >= now - ENDED_AUCTION_HISTORY_VISIBLE_MS
}

function historyRow(record: HistoryInput, refreshNotifiedAt: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = {
    user_id: record.userId,
    condition_id: record.conditionId,
    condition_name: record.conditionName,
    auction_id: record.auctionId,
    title: record.title,
    price: record.price,
    url: record.url,
    image_url: record.imageUrl ?? null,
    remaining: record.remaining ?? null,
    end_at: record.endAt ?? null,
  }
  if (refreshNotifiedAt) row.notified_at = record.notifiedAt
  return row
}

async function upsertHistory(record: HistoryInput, refreshNotifiedAt: boolean): Promise<void> {
  const { data: existing, error: selectErr } = await supabaseAdmin
    .from('notification_history')
    .select('id')
    .eq('user_id', record.userId)
    .eq('auction_id', record.auctionId)
    .order('notified_at', { ascending: false })
    .limit(20)
  throwOnError(selectErr, 'notification_history取得エラー')

  const rows = existing ?? []
  if (rows.length > 0) {
    const keepId = rows[0].id as string
    const { error: updateErr } = await supabaseAdmin
      .from('notification_history')
      .update(historyRow(record, refreshNotifiedAt))
      .eq('id', keepId)
    throwOnError(updateErr, 'notification_history更新エラー')

    const duplicateIds = rows.slice(1).map(r => r.id as string)
    if (duplicateIds.length > 0) {
      const { error: deleteErr } = await supabaseAdmin
        .from('notification_history')
        .delete()
        .in('id', duplicateIds)
      throwOnError(deleteErr, 'notification_history重複削除エラー')
    }
    return
  }

  const { error: insertErr } = await supabaseAdmin
    .from('notification_history')
    .insert(historyRow(record, true))
  throwOnError(insertErr, 'notification_history保存エラー')
}

async function upsertHistories(records: HistoryInput[], refreshNotifiedAt: boolean): Promise<void> {
  const unique = new Map<string, HistoryInput>()
  for (const record of records) {
    unique.set(`${record.userId}:${record.auctionId}`, record)
  }
  const deduped = [...unique.values()]
  if (deduped.length === 0) return

  const batchSize = Math.max(25, Number.parseInt(process.env.HISTORY_UPSERT_BATCH_SIZE ?? '100', 10) || 100)
  for (let i = 0; i < deduped.length; i += batchSize) {
    const batch = deduped.slice(i, i + batchSize)
    const rows = batch.map(record => historyRow(record, refreshNotifiedAt))
    const { error } = await supabaseAdmin
      .from('notification_history')
      .upsert(rows, { onConflict: 'user_id,auction_id' })

    if (!error) continue

    // migration_008 適用前など、bulk upsert の競合キーが使えない環境では既存の安全経路へフォールバック。
    for (const record of batch) {
      await upsertHistory(record, refreshNotifiedAt)
    }
  }
}

export async function addHistory(record: HistoryInput): Promise<void> {
  if (isNeonEnabled()) return neonHistory.addHistory(record)
  await upsertHistory(record, true)
}

export async function addHistories(records: HistoryInput[]): Promise<void> {
  if (isNeonEnabled()) return neonHistory.addHistories(records)
  await upsertHistories(records, true)
}

export async function updateHistorySnapshot(record: HistoryInput): Promise<void> {
  if (isNeonEnabled()) return neonHistory.updateHistorySnapshot(record)
  await upsertHistory(record, false)
}

export async function updateHistorySnapshots(records: HistoryInput[]): Promise<void> {
  if (isNeonEnabled()) return neonHistory.updateHistorySnapshots(records)
  await upsertHistories(records, false)
}

export async function addConditionCheckHistory(
  condition: SearchCondition,
  result: { status: 'ok' | 'failed'; matchedCount?: number; freshCount?: number }
): Promise<void> {
  if (isNeonEnabled()) return neonHistory.addConditionCheckHistory(condition, result)

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

  await upsertHistory({
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
  if (isNeonEnabled()) return neonHistory.getHistory(userId, limit)
  const { data } = await supabaseAdmin
    .from('notification_history')
    .select('*')
    .eq('user_id', userId)
    .order('notified_at', { ascending: false })
    .limit(Math.max(limit * 2, 1000))
  const seen = new Set<string>()
  return (data ?? []).filter(r => {
    if (!isVisibleHistoryRow(r)) return false
    const auctionId = r.auction_id as string
    if (!auctionId) return true
    if (seen.has(auctionId)) return false
    seen.add(auctionId)
    return true
  }).slice(0, limit).map(r => ({
    id: r.id as string,
    userId: r.user_id as string,
    conditionId: r.condition_id as string,
    conditionName: r.condition_name as string,
    auctionId: r.auction_id as string,
    title: r.title as string,
    price: r.price as string,
    url: r.url as string,
    imageUrl: (r.image_url as string) ?? '',
    notifiedAt: r.notified_at as string,
    remaining: (r.remaining as string) ?? null,
    endAt: (r.end_at as string) ?? null,
    kind: String(r.auction_id ?? '').startsWith(CHECK_HISTORY_PREFIX) ? 'check' : 'auction',
  }))
}

export async function cleanupEndedHistoryForUser(userId: string): Promise<number> {
  if (isNeonEnabled()) return neonHistory.cleanupEndedHistoryForUser(userId)
  const cutoff = new Date(Date.now() - ENDED_AUCTION_HISTORY_VISIBLE_MS).toISOString()
  const { data, error } = await supabaseAdmin
    .from('notification_history')
    .delete()
    .eq('user_id', userId)
    .not('auction_id', 'like', `${CHECK_HISTORY_PREFIX}%`)
    .not('end_at', 'is', null)
    .lt('end_at', cutoff)
    .select('id')
  throwOnError(error, 'ユーザー別終了済み履歴削除エラー')
  return data?.length ?? 0
}
