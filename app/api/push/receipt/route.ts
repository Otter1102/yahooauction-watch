import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const notificationId = typeof body.notificationId === 'string' ? body.notificationId.slice(0, 120) : 'unknown'
  const auctionId = typeof body.auctionId === 'string' ? body.auctionId.slice(0, 120) : null
  const title = typeof body.title === 'string' ? body.title.slice(0, 80) : ''
  const userIdHint = typeof body.userIdHint === 'string' ? body.userIdHint.slice(0, 8) : null
  const receivedAt = typeof body.receivedAt === 'string' ? body.receivedAt : new Date().toISOString()

  console.log('[push/receipt] service-worker-received', {
    notificationId,
    auctionId,
    title,
    userIdHint,
    receivedAt,
  })

  return NextResponse.json({ ok: true })
}
