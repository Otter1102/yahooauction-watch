/**
 * Supabase ストレージ層
 * フロントエンドからはAPI routes経由で呼ぶ
 * GitHub Actionsスクリプトからは直接 supabaseAdmin を使う
 */
import { getSupabaseAdmin } from './supabase'
const supabaseAdmin = { from: (...args: Parameters<ReturnType<typeof getSupabaseAdmin>['from']>) => getSupabaseAdmin().from(...args) }
import { SearchCondition, User, NotificationRecord } from './types'

// ==================== Users ====================

export async function userExists(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('id', userId)
    .single()
  return !!data
}

export async function getOrCreateUser(userId: string): Promise<User> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  if (data) return dbToUser(data)

  const { data: created } = await supabaseAdmin
    .from('users')
    .insert({ id: userId })
    .select()
    .single()

  return dbToUser(created!)
}

export async function updateUser(userId: string, updates: Partial<User>): Promise<void> {
  const row: Record<string, unknown> = {}
  if (updates.ntfyTopic           !== undefined) row.ntfy_topic           = updates.ntfyTopic
  if (updates.discordWebhook      !== undefined) row.discord_webhook      = updates.discordWebhook
  if (updates.notificationChannel !== undefined) row.notification_channel = updates.notificationChannel
  if ('pushSub' in updates)                      row.push_sub             = updates.pushSub ?? null
  await supabaseAdmin.from('users').update(row).eq('id', userId)
}

export async function getUsersWithPush(userIds: string[]): Promise<Map<string, import('./types').PushSub>> {
  const { data } = await supabaseAdmin
    .from('users')
    .select('id, push_sub')
    .in('id', userIds)
    .not('push_sub', 'is', null)
  const map = new Map<string, import('./types').PushSub>()
  for (const row of data ?? []) {
    if (row.push_sub) map.set(row.id as string, row.push_sub as import('./types').PushSub)
  }
  return map
}

function dbToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    ntfyTopic: (row.ntfy_topic as string) ?? '',
    discordWebhook: (row.discord_webhook as string) ?? '',
    notificationChannel: (row.notification_channel as User['notificationChannel']) ?? 'webpush',
    pushSub: (row.push_sub as import('./types').PushSub) ?? null,
  }
}

// ==================== Conditions ====================

export async function getConditions(userId: string): Promise<SearchCondition[]> {
  const { data } = await supabaseAdmin
    .from('conditions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  return (data ?? []).map(dbToCondition)
}

export async function getAllEnabledConditions(): Promise<SearchCondition[]> {
  const { data, error } = await supabaseAdmin
    .from('conditions')
    .select('*')
    .eq('enabled', true)
  if (error) throw new Error(`[Supabase] conditions取得エラー: ${error.message} (code=${error.code})`)
  return (data ?? []).map(dbToCondition)
}

export async function createCondition(
  userId: string,
  input: Omit<SearchCondition, 'id' | 'userId' | 'createdAt'>
): Promise<SearchCondition> {
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

export async function deleteCondition(conditionId: string): Promise<void> {
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

export async function isNotified(userId: string, auctionId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('notified_items')
    .select('auction_id')
    .eq('user_id', userId)
    .eq('auction_id', auctionId)
    .single()
  return !!data
}

export async function markNotified(userId: string, auctionId: string): Promise<void> {
  await supabaseAdmin
    .from('notified_items')
    .upsert({ user_id: userId, auction_id: auctionId })
}

export async function getNotifiedIds(userId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('notified_items')
    .select('auction_id')
    .eq('user_id', userId)
  return new Set((data ?? []).map(r => r.auction_id as string))
}

// 複数ユーザーの通知済みIDを1クエリで一括取得
// 100ユーザーでも getNotifiedIds を100回呼ぶ代わりに1回で済む
export async function getAllNotifiedIds(userIds: string[]): Promise<Map<string, Set<string>>> {
  if (userIds.length === 0) return new Map()
  const { data } = await supabaseAdmin
    .from('notified_items')
    .select('user_id, auction_id')
    .in('user_id', userIds)
  const map = new Map<string, Set<string>>()
  for (const userId of userIds) map.set(userId, new Set())
  for (const row of data ?? []) {
    map.get(row.user_id as string)?.add(row.auction_id as string)
  }
  return map
}

export async function clearNotifiedHistory(userId: string): Promise<void> {
  await supabaseAdmin.from('notified_items').delete().eq('user_id', userId)
}

export async function cleanupOldNotified(): Promise<void> {
  // 36時間以上古い重複防止レコードを削除
  // 根拠: 通知対象は「残り24時間以内」のオークション → 終了まで最大24h。
  //       終了後12時間 = 最大 notified_at + 36h 後に安全に削除できる。
  const cutoff = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString()
  await supabaseAdmin
    .from('notified_items')
    .delete()
    .lt('notified_at', cutoff)
}

export async function resetStalledNotified(): Promise<string[]> {
  // 自己修復: 48時間以上通知が届いていないのに notified_items が溜まっているユーザーを検出し、
  //           通知済みリストを強制リセット（次のcronで再通知を開始させる）
  const supabase = getSupabaseAdmin()
  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  // 48時間以上通知がないユーザーを notification_history から取得
  const { data: recentUsers } = await supabase
    .from('notification_history')
    .select('user_id')
    .gte('notified_at', cutoff48h)

  const recentSet = new Set((recentUsers ?? []).map(r => r.user_id as string))

  // 多数の notified_items を持つユーザーを取得（上位10件）
  const { data: notifiedCounts } = await supabase
    .rpc('get_notified_counts') // RPC不要: グループ集計はAPIでは難しいため別アプローチ

  // シンプルな代替: notified_itemsから全件取得してカウント（上限500）
  const { data: allNotified } = await supabase
    .from('notified_items')
    .select('user_id')
    .limit(500)

  const counts: Record<string, number> = {}
  for (const r of allNotified ?? []) {
    counts[r.user_id] = (counts[r.user_id] ?? 0) + 1
  }

  // 条件: 48時間通知なし かつ notified_items が20件以上 → ブロックされている可能性大
  const stalledUsers = Object.entries(counts)
    .filter(([uid, cnt]) => cnt >= 20 && !recentSet.has(uid))
    .map(([uid]) => uid)

  for (const uid of stalledUsers) {
    await supabase.from('notified_items').delete().eq('user_id', uid)
    console.log(`[自己修復] userId=${uid.slice(0,8)}... の notified_items をリセット (${counts[uid]}件削除)`)
  }

  return stalledUsers
}

export async function cleanupOldHistory(): Promise<void> {
  const now = Date.now()

  // 1. end_at が設定済み: オークション終了から12時間後に削除
  const cutoff12h = new Date(now - 12 * 60 * 60 * 1000).toISOString()
  await supabaseAdmin
    .from('notification_history')
    .delete()
    .not('end_at', 'is', null)
    .lt('end_at', cutoff12h)

  // 2. end_at なし（旧データ・取得失敗）: 通知から36時間後にフォールバック削除
  //    根拠: 残り24h以内のオークション → 終了まで最大24h + 余裕12h = 36h
  const cutoff36h = new Date(now - 36 * 60 * 60 * 1000).toISOString()
  await supabaseAdmin
    .from('notification_history')
    .delete()
    .is('end_at', null)
    .lt('notified_at', cutoff36h)
}

// ==================== History ====================

export async function addHistory(record: Omit<NotificationRecord, 'id'>): Promise<void> {
  await supabaseAdmin.from('notification_history').insert({
    user_id: record.userId,
    condition_id: record.conditionId,
    condition_name: record.conditionName,
    auction_id: record.auctionId,
    title: record.title,
    price: record.price,
    url: record.url,
    image_url: record.imageUrl ?? null,
    notified_at: record.notifiedAt,
    remaining: record.remaining ?? null,
    end_at: record.endAt ?? null,
  })
}

export async function getHistory(userId: string, limit = 200): Promise<NotificationRecord[]> {
  const { data } = await supabaseAdmin
    .from('notification_history')
    .select('*')
    .eq('user_id', userId)
    .order('notified_at', { ascending: false })
    .limit(limit)
  return (data ?? []).map(r => ({
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
  }))
}
