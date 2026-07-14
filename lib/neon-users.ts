import { getNeonSql } from './neon'
import type { PushSub, User } from './types'

function toUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    ntfyTopic: '',
    discordWebhook: '',
    notificationChannel: 'webpush',
    pushSub: (row.push_sub as PushSub | null) ?? null,
  }
}

export async function userExists(userId: string): Promise<boolean> {
  const sql = getNeonSql()
  const rows = (await sql`SELECT id FROM users WHERE id = ${userId} LIMIT 1`) as Array<{ id: string }>
  return rows.length > 0
}

export async function getOrCreateUser(userId: string): Promise<User> {
  const sql = getNeonSql()
  const rows = (await sql`SELECT id, push_sub FROM users WHERE id = ${userId} LIMIT 1`) as Array<Record<string, unknown>>
  if (rows.length > 0) return toUser(rows[0])

  const inserted = (await sql`
    INSERT INTO users (id) VALUES (${userId})
    ON CONFLICT (id) DO UPDATE SET id = EXCLUDED.id
    RETURNING id, push_sub
  `) as Array<Record<string, unknown>>
  return toUser(inserted[0] ?? { id: userId, push_sub: null })
}

export async function getUser(userId: string): Promise<User | null> {
  const sql = getNeonSql()
  const rows = (await sql`
    SELECT id, push_sub FROM users WHERE id = ${userId} LIMIT 1
  `) as Array<Record<string, unknown>>
  if (rows.length === 0) return null
  return toUser(rows[0])
}

export async function getPushSub(userId: string): Promise<PushSub | null> {
  const sql = getNeonSql()
  const rows = (await sql`
    SELECT push_sub FROM users WHERE id = ${userId} LIMIT 1
  `) as Array<{ push_sub: PushSub | null }>
  return (rows[0]?.push_sub as PushSub | null) ?? null
}

export async function setPushSub(userId: string, pushSub: PushSub | null): Promise<void> {
  const sql = getNeonSql()
  await sql`
    INSERT INTO users (id, push_sub) VALUES (${userId}, ${pushSub as unknown as string})
    ON CONFLICT (id) DO UPDATE SET push_sub = EXCLUDED.push_sub
  `
}

export async function clearPushSub(userId: string): Promise<void> {
  const sql = getNeonSql()
  await sql`UPDATE users SET push_sub = NULL WHERE id = ${userId}`
}

export async function getUsersWithPush(userIds: string[]): Promise<Map<string, PushSub>> {
  if (userIds.length === 0) return new Map()
  const sql = getNeonSql()
  const rows = (await sql`
    SELECT id, push_sub FROM users
    WHERE id = ANY(${userIds}::text[])
      AND push_sub IS NOT NULL
  `) as Array<{ id: string; push_sub: PushSub | null }>
  const map = new Map<string, PushSub>()
  for (const row of rows) {
    if (row.push_sub) map.set(row.id, row.push_sub as PushSub)
  }
  return map
}

export async function getUsersMap(userIds: string[]): Promise<Map<string, User>> {
  if (userIds.length === 0) return new Map()
  const sql = getNeonSql()
  const rows = (await sql`
    SELECT id, push_sub FROM users
    WHERE id = ANY(${userIds}::text[])
  `) as Array<Record<string, unknown>>
  const map = new Map<string, User>()
  for (const row of rows) map.set(row.id as string, toUser(row))
  return map
}

export async function getAllPushEnabledUserIds(): Promise<string[]> {
  const sql = getNeonSql()
  const rows = (await sql`
    SELECT id FROM users WHERE push_sub IS NOT NULL
  `) as Array<{ id: string }>
  return rows.map(r => r.id)
}

export async function setDeviceFingerprint(
  userId: string,
  deviceFingerprint: string,
  isTrial: boolean,
): Promise<void> {
  const sql = getNeonSql()
  await sql`
    UPDATE users
    SET device_fingerprint = ${deviceFingerprint}, is_trial = ${isTrial}
    WHERE id = ${userId}
  `
}

export async function clearPushSubForDuplicateDevice(
  deviceFingerprint: string,
  keepUserId: string,
): Promise<string[]> {
  const sql = getNeonSql()
  const rows = (await sql`
    UPDATE users
    SET push_sub = NULL
    WHERE device_fingerprint = ${deviceFingerprint}
      AND id <> ${keepUserId}
      AND push_sub IS NOT NULL
    RETURNING id
  `) as Array<{ id: string }>
  return rows.map(r => r.id)
}

/** push_sub なし + 指定日時より前に作成されたユーザーを削除 (幽霊ユーザー掃除) */
export async function cleanupGhostUsers(cutoffIso: string): Promise<number> {
  const sql = getNeonSql()
  const rows = (await sql`
    DELETE FROM users
    WHERE push_sub IS NULL
      AND created_at < ${cutoffIso}
    RETURNING id
  `) as Array<{ id: string }>
  return rows.length
}
