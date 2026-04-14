import { NextRequest, NextResponse } from 'next/server'
import { getOrCreateUser, updateUser } from '@/lib/storage'
import { rateGuard } from '@/lib/apiGuard'

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
    await updateUser(userId, updates)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[PUT /api/user]', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
