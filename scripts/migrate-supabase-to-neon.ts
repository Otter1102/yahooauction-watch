#!/usr/bin/env tsx
/**
 * Supabase → Neon one-shot data migration
 *
 * Supabase Free tier で REST API が egress quota で 402 になっていても、
 * 直接 Postgres 接続 (pooler / direct) は生きているケースが多いのでそっち経由で吸い出す。
 *
 * 必要 env:
 *   OLD_DATABASE_URL  : Supabase の Postgres 接続文字列
 *                      Dashboard → Project Settings → Database → Connection string (URI, Session mode 推奨)
 *                      例: postgresql://postgres.xxxx:PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres
 *   NEW_DATABASE_URL  : Neon Pooled connection string
 *                      例: postgresql://neondb_owner:npg_xxx@ep-xxx-pooler.<region>.aws.neon.tech/neondb?sslmode=require
 *
 * Optional:
 *   MIGRATE_TABLES=users,conditions,notification_history (default: users,conditions)
 *   MIGRATE_BATCH=500
 *   DRY_RUN=true   … 読み取りだけしてカウント表示
 *   OVERWRITE=false … Neon 側で既に同一 id が存在するときスキップ (default). true で UPDATE 上書き。
 *
 * 実行:
 *   OLD_DATABASE_URL="..." NEW_DATABASE_URL="..." tsx scripts/migrate-supabase-to-neon.ts
 */
import { Pool } from 'pg'

type TableName = 'users' | 'conditions' | 'notification_history'

const OLD_URL   = process.env.OLD_DATABASE_URL || ''
const NEW_URL   = process.env.NEW_DATABASE_URL || ''
const BATCH     = Math.max(50, Number.parseInt(process.env.MIGRATE_BATCH ?? '500', 10) || 500)
const DRY_RUN   = process.env.DRY_RUN === 'true'
const OVERWRITE = process.env.OVERWRITE === 'true'
const TABLES    = (process.env.MIGRATE_TABLES ?? 'users,conditions')
  .split(',').map(s => s.trim()).filter(Boolean) as TableName[]

if (!OLD_URL || !NEW_URL) {
  console.error('[migrate] OLD_DATABASE_URL / NEW_DATABASE_URL の両方を設定してください')
  process.exit(1)
}

const oldPool = new Pool({ connectionString: OLD_URL, ssl: { rejectUnauthorized: false }, max: 4 })
const newPool = new Pool({ connectionString: NEW_URL, ssl: { rejectUnauthorized: false }, max: 4 })

async function ping(pool: Pool, label: string): Promise<void> {
  const r = await pool.query('SELECT 1 AS ok')
  console.log(`[${label}] ping ok=${r.rows[0]?.ok}`)
}

async function migrateUsers(): Promise<{ scanned: number; upserted: number; skipped: number }> {
  const { rows } = await oldPool.query(
    // 存在しないカラムがあってもクラッシュしないよう厳選
    "SELECT id, push_sub, device_fingerprint, is_trial, created_at FROM public.users"
  )
  console.log(`[users] Supabase 側取得: ${rows.length} 件`)
  if (DRY_RUN) return { scanned: rows.length, upserted: 0, skipped: rows.length }

  let upserted = 0
  let skipped = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    for (const row of batch) {
      const sub = row.push_sub ? JSON.stringify(row.push_sub) : null
      const created = row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
      const isTrial = Boolean(row.is_trial)
      if (OVERWRITE) {
        await newPool.query(
          `INSERT INTO public.users (id, push_sub, device_fingerprint, is_trial, created_at)
           VALUES ($1, $2::jsonb, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             push_sub = EXCLUDED.push_sub,
             device_fingerprint = COALESCE(EXCLUDED.device_fingerprint, public.users.device_fingerprint),
             is_trial = EXCLUDED.is_trial`,
          [row.id, sub, row.device_fingerprint ?? null, isTrial, created]
        )
        upserted++
      } else {
        const r = await newPool.query(
          `INSERT INTO public.users (id, push_sub, device_fingerprint, is_trial, created_at)
           VALUES ($1, $2::jsonb, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING
           RETURNING id`,
          [row.id, sub, row.device_fingerprint ?? null, isTrial, created]
        )
        if (r.rowCount && r.rowCount > 0) upserted++
        else skipped++
      }
    }
    console.log(`[users] ${Math.min(i + BATCH, rows.length)}/${rows.length} 完了`)
  }
  return { scanned: rows.length, upserted, skipped }
}

async function migrateConditions(): Promise<{ scanned: number; upserted: number; skipped: number }> {
  // last_checked_at / last_found_count / max_bids はマイグレーション後追加された可能性があるので個別に選ぶ
  const columns = [
    'id', 'user_id', 'name', 'keyword', 'max_price', 'min_price', 'min_bids', 'max_bids',
    'seller_type', 'item_condition', 'sort_by', 'sort_order', 'buy_it_now', 'enabled',
    'last_checked_at', 'last_found_count', 'created_at',
  ]
  const query = `SELECT ${columns.map(c => `${c}`).join(', ')} FROM public.conditions`
  let rows: any[] = []
  try {
    const r = await oldPool.query(query)
    rows = r.rows
  } catch (e: any) {
    // カラムが無い環境は許容: 最小セットで再取得
    console.warn('[conditions] フルカラム取得失敗、最小セットで再試行:', e?.message)
    const min = 'id, user_id, name, keyword, max_price, min_price, enabled, created_at'
    const r = await oldPool.query(`SELECT ${min} FROM public.conditions`)
    rows = r.rows
  }
  console.log(`[conditions] Supabase 側取得: ${rows.length} 件`)
  if (DRY_RUN) return { scanned: rows.length, upserted: 0, skipped: rows.length }

  let upserted = 0
  let skipped = 0

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    for (const row of batch) {
      const values: any[] = [
        row.id,
        row.user_id,
        row.name ?? '(未設定)',
        row.keyword ?? '',
        Number(row.max_price ?? 0),
        Number(row.min_price ?? 0),
        Number(row.min_bids ?? 0),
        row.max_bids === undefined || row.max_bids === null ? null : Number(row.max_bids),
        row.seller_type ?? 'all',
        row.item_condition ?? 'all',
        row.sort_by ?? 'endTime',
        row.sort_order ?? 'asc',
        row.buy_it_now === undefined ? null : row.buy_it_now,
        row.enabled ?? true,
        row.last_checked_at ? new Date(row.last_checked_at).toISOString() : null,
        row.last_found_count === undefined ? null : row.last_found_count,
        row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      ]

      const insertSql = `
        INSERT INTO public.conditions
          (id, user_id, name, keyword, max_price, min_price, min_bids, max_bids,
           seller_type, item_condition, sort_by, sort_order, buy_it_now, enabled,
           last_checked_at, last_found_count, created_at)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (id) DO ${OVERWRITE ? `UPDATE SET
          user_id = EXCLUDED.user_id,
          name = EXCLUDED.name,
          keyword = EXCLUDED.keyword,
          max_price = EXCLUDED.max_price,
          min_price = EXCLUDED.min_price,
          min_bids = EXCLUDED.min_bids,
          max_bids = EXCLUDED.max_bids,
          seller_type = EXCLUDED.seller_type,
          item_condition = EXCLUDED.item_condition,
          sort_by = EXCLUDED.sort_by,
          sort_order = EXCLUDED.sort_order,
          buy_it_now = EXCLUDED.buy_it_now,
          enabled = EXCLUDED.enabled,
          last_checked_at = EXCLUDED.last_checked_at,
          last_found_count = EXCLUDED.last_found_count` : 'NOTHING'}
        RETURNING id`

      try {
        const r = await newPool.query(insertSql, values)
        if (r.rowCount && r.rowCount > 0) upserted++
        else skipped++
      } catch (err: any) {
        if (err.code === '23503') {
          // user_id が新 users に無い → 先に users を空パス作成して再試行
          try {
            await newPool.query(
              `INSERT INTO public.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
              [row.user_id]
            )
            const r2 = await newPool.query(insertSql, values)
            if (r2.rowCount && r2.rowCount > 0) upserted++
            else skipped++
          } catch (e2: any) {
            console.error(`[conditions] id=${row.id} 挿入失敗:`, e2?.message)
            skipped++
          }
        } else {
          console.error(`[conditions] id=${row.id} 挿入失敗:`, err?.message)
          skipped++
        }
      }
    }
    console.log(`[conditions] ${Math.min(i + BATCH, rows.length)}/${rows.length} 完了`)
  }
  return { scanned: rows.length, upserted, skipped }
}

async function main() {
  console.log(`[migrate] tables=${TABLES.join(',')} batch=${BATCH} dryRun=${DRY_RUN} overwrite=${OVERWRITE}`)
  await ping(oldPool, 'OLD')
  await ping(newPool, 'NEW')

  const report: Record<string, { scanned: number; upserted: number; skipped: number }> = {}
  for (const t of TABLES) {
    console.log(`\n=== ${t} ===`)
    if (t === 'users') report[t] = await migrateUsers()
    else if (t === 'conditions') report[t] = await migrateConditions()
    else console.warn(`[migrate] 未対応テーブル: ${t}（スキップ）`)
  }

  console.log('\n=== SUMMARY ===')
  for (const [table, r] of Object.entries(report)) {
    console.log(`${table}: scanned=${r.scanned}, upserted=${r.upserted}, skipped=${r.skipped}`)
  }
  await oldPool.end()
  await newPool.end()
}

main().catch(async (err) => {
  console.error('[migrate] 致命的エラー:', err?.message ?? err)
  try { await oldPool.end() } catch {}
  try { await newPool.end() } catch {}
  process.exit(1)
})
