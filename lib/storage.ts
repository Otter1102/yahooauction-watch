/**
 * Supabase ストレージ層
 * フロントエンドからはAPI routes経由で呼ぶ
 * GitHub Actionsスクリプトからは直接 supabaseAdmin を使う
 */
import { getSupabaseAdmin } from './supabase'
const supabaseAdmin = { from: (...args: Parameters<ReturnType<typeof getSupabaseAdmin>['from']>) => getSupabaseAdmin().from(...args) }
import { SearchCondition, User, NotificationRecord } from './types'

// ==================== Users ====================

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
  await supabaseAdmin.from('users').update({
    ntfy_topic: updates.ntfyTopic,
    discord_webhook: updates.discordWebhook,
    notification_channel: updates.notificationChannel,
  }).eq('id', userId)
}

function dbToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    ntfyTopic: (row.ntfy_topic as string) ?? '',
    discordWebhook: (row.discord_webhook as string) ?? '',
    notificationChannel: (row.notification_channel as User['notificationChannel']) ?? 'ntfy',
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
  const { data } = await supabaseAdmin
    .from('conditions')
    .select('*')
    .eq('enabled', true)
  return (data ?? []).map(dbToCondition)
}

export async function createCondition(
  userId: string,
  input: Omit<SearchCondition, 'id' | 'userId' | 'createdAt'>
): Promise<SearchCondition> {
  const { data } = await supabaseAdmin
    .from('conditions')
    .insert({
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
      buy_it_now: input.buyItNow ?? false,
      enabled: input.enabled ?? true,
    })
    .select()
    .single()
  return dbToCondition(data!)
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
    sellerType: (row.seller_type as SearchCondition['sellerType']) ?? 'all',
    itemCondition: (row.item_condition as SearchCondition['itemCondition']) ?? 'all',
    sortBy: (row.sort_by as SearchCondition['sortBy']) ?? 'endTime',
    sortOrder: (row.sort_order as SearchCondition['sortOrder']) ?? 'asc',
    buyItNow: (row.buy_it_now as boolean) ?? false,
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

export async function clearNotifiedHistory(userId: string): Promise<void> {
  await supabaseAdmin.from('notified_items').delete().eq('user_id', userId)
}

export async function cleanupOldNotified(): Promise<void> {
  // 7日以上古い重複防止レコードを削除（ヤフオク最長出品期間をカバー）
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  await supabaseAdmin
    .from('notified_items')
    .delete()
    .lt('notified_at', cutoff)
}

export async function cleanupOldHistory(hours = 72): Promise<void> {
  // 終了済みオークションの通知履歴を削除（デフォルト72時間＝3日後）
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
  await supabaseAdmin
    .from('notification_history')
    .delete()
    .lt('notified_at', cutoff)
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
    image_url: record.imageUrl ?? '',
  })
}

export async function getHistory(userId: string, limit = 50): Promise<NotificationRecord[]> {
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
  }))
}
