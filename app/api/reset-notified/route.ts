import { NextRequest, NextResponse } from 'next/server'
import { clearNotifiedHistory } from '@/lib/storage'

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    await clearNotifiedHistory(userId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
