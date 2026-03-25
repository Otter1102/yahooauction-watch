import { NextResponse } from 'next/server'
import { getConditions, createCondition } from '@/lib/storage'

export async function GET(req: Request) {
  try {
    const userId = new URL(req.url).searchParams.get('userId')
    if (!userId) return NextResponse.json([], { status: 200 })
    const conditions = await getConditions(userId)
    return NextResponse.json(conditions)
  } catch (e) {
    console.error('[GET /api/conditions]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      userId, name, keyword, maxPrice, minPrice,
      minBids, sellerType, itemCondition, sortBy, sortOrder, buyItNow,
    } = body
    if (!userId || !name || !keyword || !maxPrice) {
      return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 })
    }
    const condition = await createCondition(userId, {
      name: String(name),
      keyword: String(keyword),
      maxPrice: Number(maxPrice),
      minPrice: Number(minPrice ?? 0),
      minBids: Number(minBids ?? 0),
      sellerType: sellerType ?? 'all',
      itemCondition: itemCondition ?? 'all',
      sortBy: sortBy ?? 'endTime',
      sortOrder: sortOrder ?? 'asc',
      buyItNow: Boolean(buyItNow ?? false),
      enabled: true,
    })
    return NextResponse.json(condition, { status: 201 })
  } catch (e) {
    console.error('[POST /api/conditions]', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
