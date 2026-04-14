import { NextResponse } from 'next/server'
import { getVapidPublicKey } from '@/lib/webpush'

export const dynamic = 'force-dynamic'

export function GET() {
  // trim() で改行・空白を除去（echo登録時の末尾\n対策）
  const publicKey = getVapidPublicKey().trim() || null
  return NextResponse.json({ publicKey })
}
