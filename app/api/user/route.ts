import { NextRequest, NextResponse } from 'next/server'
import { getOrCreateUser, updateUser } from '@/lib/storage'
import { rateGuard } from '@/lib/apiGuard'

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

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    const limited = rateGuard(`user-get:${userId}`, 20, 60_000)
    if (limited) return limited
    const user = await getOrCreateUser(userId)
    return NextResponse.json(user)
  } catch (e) {
    console.error('[POST /api/user]', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { userId, ...updates } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    const limited = rateGuard(`user-put:${userId}`, 20, 60_000)
    if (limited) return limited
    const validationError = validateUserUpdates(updates)
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })
    await updateUser(userId, updates)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[PUT /api/user]', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
