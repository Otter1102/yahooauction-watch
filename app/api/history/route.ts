import { NextResponse } from 'next/server'
import { getHistory } from '@/lib/storage'

export async function GET(req: Request) {
  const userId = new URL(req.url).searchParams.get('userId')
  if (!userId) return NextResponse.json([])
  const history = await getHistory(userId)
  return NextResponse.json(history)
}
