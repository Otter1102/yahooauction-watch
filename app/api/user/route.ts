import { NextResponse } from 'next/server'
import { getOrCreateUser, updateUser } from '@/lib/storage'

export async function POST(req: Request) {
  try {
    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    const user = await getOrCreateUser(userId)
    return NextResponse.json(user)
  } catch (e) {
    console.error('[POST /api/user]', e)
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
    console.error('[PUT /api/user]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
