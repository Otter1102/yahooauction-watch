#!/usr/bin/env tsx
/**
 * Supabase project migration for Yahoo Auction Watcher.
 *
 * Required env:
 *   OLD_SUPABASE_URL
 *   OLD_SUPABASE_SERVICE_KEY
 *   NEW_SUPABASE_URL              (or NEXT_PUBLIC_SUPABASE_URL)
 *   NEW_SUPABASE_SERVICE_KEY      (or SUPABASE_SERVICE_KEY)
 *
 * Optional env:
 *   MIGRATE_TABLES=users,conditions,notification_history,notified_items,trial_sessions
 *   MIGRATE_PAGE_SIZE=500
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js'

type TableName =
  | 'users'
  | 'conditions'
  | 'notification_history'
  | 'notified_items'
  | 'trial_sessions'

const DEFAULT_TABLES: TableName[] = [
  'users',
  'conditions',
  'notification_history',
  'notified_items',
  'trial_sessions',
]

const PAGE_SIZE = Math.max(50, Number.parseInt(process.env.MIGRATE_PAGE_SIZE ?? '500', 10) || 500)
const FETCH_TIMEOUT_MS = Math.max(20_000, Number.parseInt(process.env.SUPABASE_FETCH_TIMEOUT_MS ?? '120000', 10) || 120_000)

const TARGET_COLUMNS: Record<TableName, string[]> = {
  users: [
    'id',
    'ntfy_topic',
    'discord_webhook',
    'notification_channel',
    'push_sub',
    'device_fingerprint',
    'is_trial',
    'created_at',
  ],
  conditions: [
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
    'last_checked_at',
    'last_found_count',
    'created_at',
  ],
  notification_history: [
    'id',
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
    'notified_at',
  ],
  notified_items: [
    'user_id',
    'auction_id',
    'notified_at',
  ],
  trial_sessions: [
    'fp_hash',
    'ip_hash',
    'cookie_id',
    'push_endpoint',
    'created_at',
    'expires_at',
  ],
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] || (fallback ? process.env[fallback] : '')
  if (!value) throw new Error(`Missing env: ${name}${fallback ? ` or ${fallback}` : ''}`)
  return value.replace(/\\n/g, '').trim()
}

function supabase(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }),
    },
  })
}

function selectedTables(): TableName[] {
  const raw = process.env.MIGRATE_TABLES
  if (!raw) return DEFAULT_TABLES
  const values = raw.split(',').map(v => v.trim()).filter(Boolean)
  for (const value of values) {
    if (!DEFAULT_TABLES.includes(value as TableName)) {
      throw new Error(`Unknown table in MIGRATE_TABLES: ${value}`)
    }
  }
  return values as TableName[]
}

function conflictColumns(table: TableName): string {
  switch (table) {
    case 'users':
      return 'id'
    case 'conditions':
      return 'id'
    case 'notification_history':
      return 'id'
    case 'notified_items':
      return 'user_id,auction_id'
    case 'trial_sessions':
      return 'fp_hash'
  }
}

function selectOrder(table: TableName): string {
  switch (table) {
    case 'conditions':
    case 'notified_items':
    case 'trial_sessions':
      return 'created_at'
    case 'notification_history':
      return 'notified_at'
    case 'users':
      return 'created_at'
  }
}

async function countRows(client: SupabaseClient, table: TableName): Promise<number> {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true })
  if (error) throw new Error(`${table} count failed: ${error.message || JSON.stringify(error)}`)
  return count ?? 0
}

async function readPage(client: SupabaseClient, table: TableName, from: number, to: number): Promise<Record<string, unknown>[]> {
  const { data, error } = await client
    .from(table)
    .select('*')
    .order(selectOrder(table), { ascending: true, nullsFirst: false })
    .range(from, to)
  if (error) throw new Error(`${table} read failed: ${error.message || JSON.stringify(error)}`)
  return (data ?? []) as Record<string, unknown>[]
}

async function upsertRows(client: SupabaseClient, table: TableName, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return
  rows = rows.map(row => {
    const allowed = new Set(TARGET_COLUMNS[table])
    return Object.fromEntries(Object.entries(row).filter(([key]) => allowed.has(key)))
  })

  const { error } = await client
    .from(table)
    .upsert(rows, { onConflict: conflictColumns(table) })

  if (!error) return

  // notification_history の部分unique index環境などでbulk upsertが失敗する場合は、
  // 1件ずつ入れて移行全体を止めない。
  if (table !== 'notification_history') {
    throw new Error(`${table} upsert failed: ${error.message || JSON.stringify(error)}`)
  }

  let skipped = 0
  for (const row of rows) {
    const { error: oneError } = await client
      .from(table)
      .upsert(row, { onConflict: conflictColumns(table) })
    if (!oneError) continue
    skipped += 1
    if (skipped <= 10 || skipped % 100 === 0) {
      console.warn(`[migrate] ${table} row skipped: ${oneError.message || JSON.stringify(oneError)}`)
    }
  }
  if (skipped > 0) console.warn(`[migrate] ${table} skipped rows=${skipped}`)
}

async function migrateTable(oldClient: SupabaseClient, newClient: SupabaseClient, table: TableName): Promise<void> {
  const total = await countRows(oldClient, table)
  console.log(`[migrate] ${table}: source rows=${total}`)
  if (total === 0) return

  let copied = 0
  for (let offset = 0; offset < total; offset += PAGE_SIZE) {
    const rows = await readPage(oldClient, table, offset, offset + PAGE_SIZE - 1)
    await upsertRows(newClient, table, rows)
    copied += rows.length
    console.log(`[migrate] ${table}: copied ${copied}/${total}`)
    if (rows.length === 0) break
  }
}

async function main() {
  const oldUrl = required('OLD_SUPABASE_URL')
  const oldKey = required('OLD_SUPABASE_SERVICE_KEY')
  const newUrl = required('NEW_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL')
  const newKey = required('NEW_SUPABASE_SERVICE_KEY', 'SUPABASE_SERVICE_KEY')

  if (oldUrl === newUrl) throw new Error('Old and new Supabase URLs are the same; aborting')

  const oldClient = supabase(oldUrl, oldKey)
  const newClient = supabase(newUrl, newKey)
  const tables = selectedTables()

  console.log(`[migrate] start old=${oldUrl} new=${newUrl}`)
  for (const table of tables) {
    await migrateTable(oldClient, newClient, table)
  }

  console.log('[migrate] final counts')
  for (const table of tables) {
    const count = await countRows(newClient, table)
    console.log(`[migrate] new ${table}: ${count}`)
  }
  console.log('[migrate] done')
}

main().catch(error => {
  console.error('[migrate] failed:', error instanceof Error ? error.message : error)
  process.exit(1)
})
