import { NextResponse } from 'next/server'
import { getOrCreateUser, updateUser } from '@/lib/storage'
import { sendTestNtfy, sendTestDiscord } from '@/lib/notifier'

export async function GET(req: Request) {
  try {
    const userId = new URL(req.url).searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    const user = await getOrCreateUser(userId)
    return NextResponse.json(user)
  } catch (e) {
    console.error('[GET /api/settings]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const { userId, ...updates } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    await updateUser(userId, updates)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[PUT /api/settings]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { action, userId } = await req.json()
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
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
