import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { updateCondition, deleteCondition } from '@/lib/storage'
import { rateGuard } from '@/lib/apiGuard'

/** conditionId が userId のものか確認 */
async function verifyOwnership(conditionId: string, userId: string): Promise<boolean> {
  const { data } = await getSupabaseAdmin()
    .from('conditions')
    .select('id')
    .eq('id', conditionId)
    .eq('user_id', userId)
    .single()
  return !!data
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json()
    const { userId, ...updates } = body

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId required' }, { status: 400 })
    }
    // レート制限: 30回/分
    const limited = rateGuard(`conditions-put:${userId}`, 30, 60_000)
    if (limited) return limited
    // 所有権チェック: 他ユーザーの条件は変更不可
    const owned = await verifyOwnership(params.id, userId)
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // キーワードに全角括弧が含まれていたら半角に変換
    if (typeof updates.keyword === 'string') {
      updates.keyword = updates.keyword.replace(/（/g, '(').replace(/）/g, ')')
    }

    await updateCondition(params.id, updates)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[PUT /api/conditions/[id]]', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // DELETEはボディがないことが多いのでクエリパラメータで受け取る
    const userId = new URL(req.url).searchParams.get('userId')

    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    // レート制限: 20回/分
    const limited = rateGuard(`conditions-del:${userId}`, 20, 60_000)
    if (limited) return limited
    // 所有権チェック: 他ユーザーの条件は削除不可
    const owned = await verifyOwnership(params.id, userId)
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await deleteCondition(params.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[DELETE /api/conditions/[id]]', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
