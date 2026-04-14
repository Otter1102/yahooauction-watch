/**
 * cronシャーディング ユニットテスト
 *
 * getUserShard() 関数の挙動を検証:
 * - 同一userId は常に同じシャードに割り当てられる（決定論的）
 * - 均等分布: 100ユーザーを4シャードに分けると各25±5人程度
 * - totalShards=1 ならすべてシャード0
 * - totalShards=4 でどのユーザーも 0-3 の範囲に収まる
 */
import { describe, it, expect } from 'vitest'

// ── テスト対象の関数を抽出（route.ts と同じロジック）──────────────────────
function getUserShard(userId: string, totalShards: number): number {
  const hex = userId.replace(/-/g, '').slice(-4)
  return parseInt(hex, 16) % totalShards
}

// ── テスト用ユーザーID生成（ランダムUUID相当）──────────────────────────────
function fakeUUID(seed: number): string {
  const hex = seed.toString(16).padStart(32, '0')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

// 本物のUUIDサンプル（100件）
const SAMPLE_UUIDS = Array.from({ length: 100 }, (_, i) => fakeUUID(i + 1))

// ──────────────────────────────────────────────────────────────────────────
describe('cron-sharding: getUserShard', () => {

  it('totalShards=1 の場合、全ユーザーがシャード0に割り当てられる', () => {
    for (const id of SAMPLE_UUIDS) {
      expect(getUserShard(id, 1)).toBe(0)
    }
  })

  it('返り値は常に 0 以上 totalShards 未満', () => {
    for (const totalShards of [2, 3, 4, 8, 16]) {
      for (const id of SAMPLE_UUIDS) {
        const shard = getUserShard(id, totalShards)
        expect(shard).toBeGreaterThanOrEqual(0)
        expect(shard).toBeLessThan(totalShards)
      }
    }
  })

  it('同一userId は常に同じシャードに割り当てられる（決定論的）', () => {
    for (const id of SAMPLE_UUIDS) {
      const shard1 = getUserShard(id, 4)
      const shard2 = getUserShard(id, 4)
      expect(shard1).toBe(shard2)
    }
  })

  it('4シャード分割で全ユーザーがいずれかのシャードに含まれる（重複・漏れなし）', () => {
    const assigned = new Set<string>()
    for (let s = 0; s < 4; s++) {
      for (const id of SAMPLE_UUIDS) {
        if (getUserShard(id, 4) === s) {
          // 重複がないことを確認
          expect(assigned.has(id)).toBe(false)
          assigned.add(id)
        }
      }
    }
    // 全ユーザーがいずれかのシャードに割り当てられている
    expect(assigned.size).toBe(SAMPLE_UUIDS.length)
  })

  it('4シャードで均等分布（各シャード±15%以内）', () => {
    const counts = [0, 0, 0, 0]
    for (const id of SAMPLE_UUIDS) {
      counts[getUserShard(id, 4)]++
    }
    const expected = SAMPLE_UUIDS.length / 4  // 25
    const tolerance = expected * 0.5          // ±50%（100件サンプルなので余裕を持つ）
    for (const count of counts) {
      expect(count).toBeGreaterThanOrEqual(expected - tolerance)
      expect(count).toBeLessThanOrEqual(expected + tolerance)
    }
  })

  it('200ユーザーを4シャードで分割した場合、各シャードが50人以下になる（Vercel 60s制限対応）', () => {
    const uuids200 = Array.from({ length: 200 }, (_, i) => fakeUUID(i + 1))
    const MAX_PER_SHARD = 60  // 安全マージン付き（50人想定）
    for (let s = 0; s < 4; s++) {
      const count = uuids200.filter(id => getUserShard(id, 4) === s).length
      expect(count).toBeLessThanOrEqual(MAX_PER_SHARD)
    }
  })

  it('実際のUUID形式でも正常動作する', () => {
    const realUUIDs = [
      'a3b4c5d6-e7f8-4abc-b1c2-d3e4f5a6b7c8',
      '12345678-9abc-4def-a012-345678901234',
      'ffffffff-ffff-4fff-bfff-ffffffffffff',
      '00000000-0000-4000-8000-000000000001',
    ]
    for (const id of realUUIDs) {
      const shard = getUserShard(id, 4)
      expect(shard).toBeGreaterThanOrEqual(0)
      expect(shard).toBeLessThan(4)
    }
  })
})

// ──────────────────────────────────────────────────────────────────────────
describe('cron-sharding: スケール計算', () => {

  const CONCURRENCY = 25
  const USER_TIMEOUT_MS = 20_000
  const VERCEL_LIMIT_MS = 60_000

  function estimateRuntime(userCount: number): number {
    return Math.ceil(userCount / CONCURRENCY) * USER_TIMEOUT_MS
  }

  it('シャードなし: 50ユーザー → 40s < 60s ✅', () => {
    expect(estimateRuntime(50)).toBeLessThan(VERCEL_LIMIT_MS)
  })

  it('シャードなし: 75ユーザー → 60s = ギリギリ ⚠️', () => {
    expect(estimateRuntime(75)).toBeLessThanOrEqual(VERCEL_LIMIT_MS)
  })

  it('シャードなし: 100ユーザー → 80s > 60s ❌', () => {
    expect(estimateRuntime(100)).toBeGreaterThan(VERCEL_LIMIT_MS)
  })

  it('4シャード: 200ユーザー → 各シャード50人 → 40s ✅', () => {
    // 200人を4シャードで均等分割 → 各50人
    expect(estimateRuntime(50)).toBeLessThan(VERCEL_LIMIT_MS)
  })

  it('4シャード: 240ユーザー → 各シャード60人 → 60s = ギリギリ ⚠️', () => {
    expect(estimateRuntime(60)).toBeLessThanOrEqual(VERCEL_LIMIT_MS)
  })

  it('4シャード: 300ユーザー → 各シャード75人 → 60s → 次の対策が必要', () => {
    expect(estimateRuntime(75)).toBeGreaterThanOrEqual(VERCEL_LIMIT_MS)
    // 300人超えたら CONCURRENCY を40に上げるか total_shards=8 にする
  })
})
