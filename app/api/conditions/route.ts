import { NextRequest, NextResponse } from 'next/server'
import { getConditions, createCondition } from '@/lib/storage'
import { getIp, rateGuard } from '@/lib/apiGuard'

export async function GET(req: NextRequest) {
  try {
    const limited = rateGuard(`conditions-get:${getIp(req)}`, 30, 60_000)
    if (limited) return limited
    const userId = new URL(req.url).searchParams.get('userId')
    if (!userId) return NextResponse.json([], { status: 200 })
    const conditions = await getConditions(userId)
    return NextResponse.json(conditions)
  } catch (e) {
    console.error('[GET /api/conditions]', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      userId, name, keyword, maxPrice, minPrice,
      minBids, maxBids, sellerType, itemCondition, sortBy, sortOrder, buyItNow,
    } = body
    if (!userId || !name || !keyword || !maxPrice) {
      return NextResponse.json({ error: '必須項目が不足しています' }, { status: 400 })
    }
    // レート制限: userId単位で20回/分
    const limited = rateGuard(`conditions-post:${userId}`, 20, 60_000)
    if (limited) return limited

    // 上限チェック（トライアル: 5件 / 通常: 30件）
    const isTrial = process.env.NEXT_PUBLIC_TRIAL_MODE === 'true'
    const LIMIT = isTrial ? 5 : 30
    const existing = await getConditions(userId)
    if (existing.length >= LIMIT) {
      return NextResponse.json(
        { error: isTrial ? `トライアルは最大${LIMIT}件まで登録できます` : `登録できる条件は最大${LIMIT}件です` },
        { status: 400 },
      )
    }
    // 入力値の長さ・範囲チェック（XSS/DB汚染防止）
    if (String(name).length > 100)    return NextResponse.json({ error: '条件名は100文字以内にしてください' }, { status: 400 })
    if (String(keyword).length > 200) return NextResponse.json({ error: 'キーワードは200文字以内にしてください' }, { status: 400 })
    const maxP = Number(maxPrice)
    const minP = Number(minPrice ?? 0)
    if (!Number.isFinite(maxP) || maxP <= 0 || maxP > 100_000_000) {
      return NextResponse.json({ error: '価格上限が不正です（1〜1億円）' }, { status: 400 })
    }
    if (!Number.isFinite(minP) || minP < 0 || minP > 100_000_000) {
      return NextResponse.json({ error: '価格下限が不正です' }, { status: 400 })
    }

    // 全角括弧 → 半角括弧に自動変換（Yahoo OR検索は半角括弧が必要）
    const normalizedKeyword = String(keyword).replace(/（/g, '(').replace(/）/g, ')')

    const condition = await createCondition(userId, {
      name: String(name),
      keyword: normalizedKeyword,
      maxPrice: Number(maxPrice),
      minPrice: Number(minPrice ?? 0),
      minBids: Number(minBids ?? 0),
      maxBids: maxBids !== undefined && maxBids !== null && maxBids !== '' ? Number(maxBids) : null,
      sellerType: sellerType ?? 'all',
      itemCondition: itemCondition ?? 'all',
      sortBy: sortBy ?? 'endTime',
      sortOrder: sortOrder ?? 'asc',
      buyItNow: buyItNow === null || buyItNow === undefined ? null : Boolean(buyItNow),
      enabled: true,
    })
    return NextResponse.json(condition, { status: 201 })
  } catch (e) {
    console.error('[POST /api/conditions]', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
