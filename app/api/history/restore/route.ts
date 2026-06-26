import { NextRequest, NextResponse } from 'next/server'
import { addHistory } from '@/lib/storage'
import { rateGuard } from '@/lib/apiGuard'
import type { NotificationRecord } from '@/lib/types'

const MAX_RESTORE_RECORDS = 200

function cleanText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback
  const text = value.trim()
  return (text || fallback).slice(0, maxLength)
}

function cleanDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  if (Number.isNaN(time)) return null
  return new Date(time).toISOString()
}

function cleanHistoryRecord(userId: string, raw: unknown): Omit<NotificationRecord, 'id'> | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const auctionId = cleanText(source.auctionId, '', 180)
  if (!auctionId) return null

  const notifiedAt = cleanDate(source.notifiedAt) ?? new Date().toISOString()
  const kind = source.kind === 'check' || auctionId.startsWith('__check_') ? 'check' : 'auction'

  return {
    userId,
    conditionId: cleanText(source.conditionId, 'restored', 160),
    conditionName: cleanText(source.conditionName, '復元履歴', 160),
    auctionId,
    title: cleanText(source.title, kind === 'check' ? '条件チェック' : '通知履歴', 300),
    price: cleanText(source.price, '', 80),
    url: cleanText(source.url, '/history', 1000),
    imageUrl: cleanText(source.imageUrl, '', 1000),
    notifiedAt,
    remaining: typeof source.remaining === 'string' ? source.remaining.slice(0, 120) : null,
    endAt: cleanDate(source.endAt),
    kind,
  }
}

export async function POST(req: NextRequest) {
  let body: { userId?: unknown; records?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  const limited = rateGuard(`history-restore:${userId}`, 5, 60_000)
  if (limited) return limited

  const records = Array.isArray(body.records)
    ? body.records.slice(0, MAX_RESTORE_RECORDS)
    : []
  if (records.length === 0) {
    return NextResponse.json({ ok: true, restored: 0, failed: 0 })
  }

  let restored = 0
  let failed = 0
  for (const raw of records) {
    const record = cleanHistoryRecord(userId, raw)
    if (!record) {
      failed++
      continue
    }
    try {
      await addHistory(record)
      restored++
    } catch (e) {
      failed++
      console.error('[history/restore] 復元失敗:', String(e))
    }
  }

  return NextResponse.json({ ok: true, restored, failed })
}
