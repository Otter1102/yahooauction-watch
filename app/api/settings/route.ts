import { NextRequest, NextResponse } from 'next/server'
import { getOrCreateUser, updateUser } from '@/lib/storage'
import { sendTestNtfy, sendTestDiscord } from '@/lib/notifier'
import { getIp, rateGuard } from '@/lib/apiGuard'

export async function GET(req: NextRequest) {
  try {
    const userId = new URL(req.url).searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    const limited = rateGuard(`settings-get:${userId}`, 60, 60_000)
    if (limited) return limited
    const user = await getOrCreateUser(userId)
    // push_sub の生データ（エンドポイントURL・暗号鍵）はクライアントに不要なので除外
    const { pushSub, ...safeUser } = user
    return NextResponse.json({ ...safeUser, hasPush: !!(pushSub?.endpoint) })
  } catch (e) {
    console.error('[GET /api/settings]', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

const VALID_CHANNELS = new Set(['webpush', 'ntfy', 'discord', 'both'])

function validateUserUpdates(updates: Record<string, unknown>): string | null {
  if (updates.ntfyTopic !== undefined) {
    if (typeof updates.ntfyTopic !== 'string' || updates.ntfyTopic.length > 256) {
      return 'ntfyTopicは256文字以内にしてください'
    }
  }
  if (updates.discordWebhook !== undefined && updates.discordWebhook !== '') {
    try {
      const host = new URL(String(updates.discordWebhook)).hostname
      if (host !== 'discord.com' && host !== 'discordapp.com') {
        return 'Discord Webhook URLが不正です'
      }
    } catch {
      return 'Discord Webhook URLが不正です'
    }
  }
  if (updates.notificationChannel !== undefined && !VALID_CHANNELS.has(String(updates.notificationChannel))) {
    return '通知チャンネルが不正です'
  }
  return null
}

export async function PUT(req: NextRequest) {
  try {
    const { userId, ...updates } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    const limited = rateGuard(`settings-put:${userId}`, 20, 60_000)
    if (limited) return limited
    const validationError = validateUserUpdates(updates)
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })
    await updateUser(userId, updates)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[PUT /api/settings]', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { action, userId } = await req.json()
    const limited = rateGuard(`settings-post:${userId ?? getIp(req)}`, 10, 60_000)
    if (limited) return limited
    if (action === 'test-ntfy') {
      const user = await getOrCreateUser(userId)
      const ok = await sendTestNtfy(user.ntfyTopic)
      return NextResponse.json({ ok })
    }
    if (action === 'test-discord') {
      const user = await getOrCreateUser(userId)
      const ok = await sendTestDiscord(user.discordWebhook)
      return NextResponse.json({ ok })
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e) {
    console.error('[POST /api/settings]', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
