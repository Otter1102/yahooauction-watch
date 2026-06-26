import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')

function readSource(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

describe('条件作成直後の初回取得', () => {
  it('/api/conditions の新規作成後に初回取得を実行する', () => {
    const source = readSource('app/api/conditions/route.ts')
    const createUser = source.indexOf('await getOrCreateUser(userId)')
    const create = source.indexOf('const condition = await createCondition')
    const initialCheck = source.indexOf('await runInitialConditionCheck(userId, condition)')
    const response = source.indexOf('return NextResponse.json({ ...condition, initialCheck }')

    expect(createUser).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(createUser)
    expect(initialCheck).toBeGreaterThan(create)
    expect(response).toBeGreaterThan(initialCheck)
  })

  it('/api/conditions/[id] の編集後にも初回取得を実行する', () => {
    const source = readSource('app/api/conditions/[id]/route.ts')
    const update = source.indexOf('await updateCondition(params.id, updates)')
    const findCondition = source.indexOf('(await getConditions(userId)).find')
    const initialCheck = source.indexOf('await runInitialConditionCheck(userId, condition)')
    const response = source.indexOf('return NextResponse.json({ ok: true, initialCheck })')

    expect(update).toBeGreaterThan(-1)
    expect(findCondition).toBeGreaterThan(update)
    expect(initialCheck).toBeGreaterThan(findCondition)
    expect(response).toBeGreaterThan(initialCheck)
  })

  it('初回取得は履歴反映後に取得完了プッシュを送る', () => {
    const source = readSource('lib/initial-check.ts')
    const addHistory = source.indexOf('addHistory(toHistoryRecord')
    const sendInitial = source.indexOf('await sendWebPushInitialFetch')
    const markNotified = source.indexOf('await runInChunks(toRecord, 10, item => markNotified')

    expect(addHistory).toBeGreaterThan(-1)
    expect(sendInitial).toBeGreaterThan(addHistory)
    expect(markNotified).toBeGreaterThan(sendInitial)
  })

  it('初回取得プッシュは取得完了メッセージで履歴へ誘導する', () => {
    const source = readSource('lib/webpush.ts')

    expect(source).toContain('sendWebPushInitialFetch')
    expect(source).toContain('取得完了しました')
    expect(source).toContain("url: APP_URL + '/history'")
  })
})
