'use client'
import { useEffect, useState } from 'react'
import { User } from '@/lib/types'

function getUserId() {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('yahoowatch_user_id')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('yahoowatch_user_id', id) }
  return id
}

export default function SettingsPage() {
  const [userId, setUserId] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'loading' | 'ok' | 'fail'>('idle')
  const [copied, setCopied] = useState(false)

  const suggestedTopic = userId ? `yw-${userId.slice(0, 10)}` : ''

  useEffect(() => {
    const id = getUserId()
    setUserId(id)
    fetch(`/api/settings?userId=${id}`).then(r => r.json()).then(setUser)
  }, [])

  async function save() {
    if (!user || !userId) return
    setSaving(true)
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ...user }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  async function test() {
    if (!userId || !user) return
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ...user }),
    })
    setTestState('loading')
    const action = user.notificationChannel === 'discord' ? 'test-discord' : 'test-ntfy'
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, userId }),
    })
    const { ok } = await res.json()
    setTestState(ok ? 'ok' : 'fail')
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function set(k: keyof User, v: string) { setUser(u => u ? { ...u, [k]: v } : u) }

  if (!user) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
      <p style={{ color: 'var(--text-tertiary)' }}>読み込み中...</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', paddingBottom: 'calc(var(--nav-height) + env(safe-area-inset-bottom,0px))' }}>

      {/* パープルグラデーションヘッダー */}
      <div style={{ background: 'var(--grad-cool)', padding: '20px 20px 18px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 22 }}>⚙️</span>
            <h1 style={{ fontWeight: 900, fontSize: 24, color: 'white', letterSpacing: '-0.5px' }}>設定</h1>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', marginLeft: 30 }}>通知先を設定してください</p>
        </div>
      </div>

      <div style={{ padding: '16px', maxWidth: 480, margin: '0 auto' }}>

        {/* 通知方法選択 */}
        <p className="section-title">通知方法</p>
        <div className="card" style={{ marginBottom: 20, overflow: 'hidden' }}>
          {(['ntfy', 'discord', 'both'] as const).map((ch, i) => (
            <button key={ch} onClick={() => set('notificationChannel', ch)}
              style={{
                width: '100%', padding: '15px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: i < 2 ? '1px solid var(--border)' : 'none',
              }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                {ch === 'ntfy' ? '📲 ntfy（推奨・完全無料）' : ch === 'discord' ? '💬 Discord' : '🔀 両方'}
              </span>
              <div style={{
                width: 24, height: 24, borderRadius: 12,
                background: user.notificationChannel === ch ? 'var(--grad-primary)' : 'transparent',
                border: `2px solid ${user.notificationChannel === ch ? 'transparent' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: user.notificationChannel === ch ? '0 4px 12px rgba(255,107,53,0.35)' : 'none',
              }}>
                {user.notificationChannel === ch && <span style={{ width: 8, height: 8, borderRadius: 4, background: 'white' }} />}
              </div>
            </button>
          ))}
        </div>

        {/* ntfy設定 */}
        {(user.notificationChannel === 'ntfy' || user.notificationChannel === 'both') && (
          <>
            <p className="section-title">ntfy 設定</p>
            <div className="card" style={{ marginBottom: 20, overflow: 'hidden' }}>
              {/* Step 1 */}
              <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 8, background: 'var(--grad-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: 'white', flexShrink: 0 }}>1</div>
                  <p style={{ fontWeight: 700, fontSize: 14 }}>アプリをインストール</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, textAlign: 'center', padding: '10px', background: 'var(--bg)', borderRadius: 12, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none', border: '1px solid var(--border)' }}>
                    🍎 iOS
                  </a>
                  <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, textAlign: 'center', padding: '10px', background: 'var(--bg)', borderRadius: 12, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none', border: '1px solid var(--border)' }}>
                    🤖 Android
                  </a>
                </div>
              </div>

              {/* Step 2 */}
              <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 8, background: 'var(--grad-cool)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: 'white', flexShrink: 0 }}>2</div>
                  <p style={{ fontWeight: 700, fontSize: 14 }}>トピック名を設定</p>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, marginLeft: 32 }}>下記をそのまま使うか、好きな名前に変更できます</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <code style={{ flex: 1, background: 'var(--accent-light)', color: 'var(--accent)', padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700 }}>
                    {suggestedTopic}
                  </code>
                  <button onClick={() => copy(suggestedTopic)}
                    style={{ padding: '10px 14px', background: copied ? 'var(--grad-teal)' : 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: copied ? 'white' : 'var(--text-secondary)', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>
                    {copied ? '✓ コピー' : 'コピー'}
                  </button>
                </div>
                <input placeholder="トピック名を入力（英数字・ハイフン）" value={user.ntfyTopic} onChange={e => set('ntfyTopic', e.target.value)} />
              </div>

              {/* Step 3 */}
              <div style={{ padding: '16px', background: '#F9F9FB' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 24, height: 24, borderRadius: 8, background: 'var(--grad-teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: 'white', flexShrink: 0 }}>3</div>
                  <p style={{ fontWeight: 700, fontSize: 14 }}>ntfyアプリで購読する</p>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.9, marginLeft: 32 }}>
                  <p>1. ntfyアプリを開く</p>
                  <p>2. 右下の「＋」をタップ</p>
                  <p>3. 上のトピック名を貼り付け</p>
                  <p>4.「Subscribe」をタップ</p>
                </div>
                <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(0,184,148,0.1)', borderRadius: 10, fontSize: 12, color: 'var(--success)', fontWeight: 700, marginLeft: 32 }}>
                  ✅ 設定完了！以降は自動で通知が届きます
                </div>
              </div>
            </div>
          </>
        )}

        {/* Discord設定 */}
        {(user.notificationChannel === 'discord' || user.notificationChannel === 'both') && (
          <>
            <p className="section-title">Discord 設定</p>
            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ padding: '16px' }}>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>
                  Discord → チャンネル設定 → 連携サービス → ウェブフック
                </p>
                <input placeholder="https://discord.com/api/webhooks/..." value={user.discordWebhook} onChange={e => set('discordWebhook', e.target.value)} />
              </div>
            </div>
          </>
        )}

        {/* テスト */}
        <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={test} disabled={testState === 'loading'}
            style={{
              padding: '14px', background: 'var(--card)',
              border: '1.5px solid var(--border)', borderRadius: 16,
              fontSize: 14, fontWeight: 700, cursor: 'pointer',
              color: 'var(--text-primary)', fontFamily: 'inherit',
            }}>
            {testState === 'loading' ? '送信中...' : '📨 テスト通知を送信'}
          </button>
          {testState === 'ok' && (
            <div style={{ padding: '12px 16px', background: 'rgba(0,184,148,0.1)', borderRadius: 12, fontSize: 13, color: 'var(--success)', fontWeight: 700, textAlign: 'center' }}>
              ✅ 通知が届きました！
            </div>
          )}
          {testState === 'fail' && (
            <div style={{ padding: '12px 16px', background: 'rgba(225,112,85,0.1)', borderRadius: 12, fontSize: 13, color: 'var(--danger)', textAlign: 'center' }}>
              ❌ 届きませんでした。トピック名を確認してください
            </div>
          )}
        </div>

        {/* 保存 */}
        <button onClick={save} disabled={saving} className="btn-primary">
          {saved ? '✓ 保存しました' : saving ? '保存中...' : '設定を保存する'}
        </button>
      </div>
    </div>
  )
}
