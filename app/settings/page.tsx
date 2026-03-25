'use client'
import { useEffect, useState } from 'react'
import { User } from '@/lib/types'

function getUserId() {
  if (typeof window === 'undefined') return ''
  let id = localStorage.getItem('yahoowatch_user_id')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('yahoowatch_user_id', id) }
  return id
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </div>
  )
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
    if (!userId) return
    setTestState('loading')
    const action = user?.notificationChannel === 'discord' ? 'test-discord' : 'test-ntfy'
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
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      {/* ヘッダー */}
      <div style={{ background: 'var(--card)', borderBottom: '1px solid var(--border)', padding: '16px 20px 14px', position: 'sticky', top: 0, zIndex: 50 }}>
        <h1 style={{ fontWeight: 800, fontSize: 22, letterSpacing: '-0.5px' }}>設定</h1>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 1 }}>通知先を設定してください</p>
      </div>

      <div style={{ padding: '16px' }}>

        {/* 通知方法選択 */}
        <p className="section-title">通知方法</p>
        <div className="card" style={{ marginBottom: 20, overflow: 'hidden' }}>
          {(['ntfy', 'discord', 'both'] as const).map((ch, i) => (
            <button key={ch} onClick={() => set('notificationChannel', ch)}
              style={{
                width: '100%', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: i < 2 ? '1px solid var(--border)' : 'none',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>
                {ch === 'ntfy' ? '📲 ntfy（推奨・完全無料）' : ch === 'discord' ? '💬 Discord' : '🔀 両方'}
              </span>
              <span style={{ width: 22, height: 22, borderRadius: 11, border: `2px solid ${user.notificationChannel === ch ? 'var(--accent)' : 'var(--border)'}`, background: user.notificationChannel === ch ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {user.notificationChannel === ch && <span style={{ width: 8, height: 8, borderRadius: 4, background: 'white' }} />}
              </span>
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
                <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>① アプリをインストール</p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, textAlign: 'center', padding: '10px', background: 'var(--bg)', borderRadius: 10, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none', border: '1px solid var(--border)' }}>
                    🍎 iOS
                  </a>
                  <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, textAlign: 'center', padding: '10px', background: 'var(--bg)', borderRadius: 10, fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none', border: '1px solid var(--border)' }}>
                    🤖 Android
                  </a>
                </div>
              </div>

              {/* Step 2 */}
              <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
                <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>② トピック名を設定</p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 }}>下記をそのまま使うか、好きな名前に変更できます</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <code style={{ flex: 1, background: 'var(--accent-light)', color: 'var(--accent)', padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700 }}>
                    {suggestedTopic}
                  </code>
                  <button onClick={() => copy(suggestedTopic)}
                    style={{ padding: '10px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: copied ? 'var(--success)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {copied ? '✓ コピー' : 'コピー'}
                  </button>
                </div>
                <input
                  placeholder="トピック名を入力（英数字・ハイフン）"
                  value={user.ntfyTopic}
                  onChange={e => set('ntfyTopic', e.target.value)}
                />
              </div>

              {/* Step 3 */}
              <div style={{ padding: '16px', background: '#F9F9FB' }}>
                <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>③ ntfyアプリで購読する</p>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                  <p>1. ntfyアプリを開く</p>
                  <p>2. 右下の「＋」をタップ</p>
                  <p>3. 上のトピック名を貼り付け</p>
                  <p>4.「Subscribe」をタップ</p>
                </div>
                <div style={{ marginTop: 10, padding: '8px 12px', background: '#E8F9ED', borderRadius: 8, fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>
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
                <input
                  placeholder="https://discord.com/api/webhooks/..."
                  value={user.discordWebhook}
                  onChange={e => set('discordWebhook', e.target.value)}
                />
              </div>
            </div>
          </>
        )}

        {/* テスト */}
        <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={test} disabled={testState === 'loading'}
            style={{ padding: '13px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer', color: 'var(--text-primary)', transition: 'background 0.15s' }}>
            {testState === 'loading' ? '送信中...' : '📨 テスト通知を送信'}
          </button>
          {testState === 'ok' && <p style={{ fontSize: 13, color: 'var(--success)', textAlign: 'center', fontWeight: 600 }}>✅ 通知が届きました！</p>}
          {testState === 'fail' && <p style={{ fontSize: 13, color: 'var(--danger)', textAlign: 'center' }}>❌ 届きませんでした。設定を確認してください</p>}
        </div>

        {/* 保存 */}
        <button onClick={save} disabled={saving} className="btn-primary" style={{ width: '100%' }}>
          {saved ? '✓ 保存しました' : saving ? '保存中...' : '設定を保存する'}
        </button>
      </div>
    </div>
  )
}
