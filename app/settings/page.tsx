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
  const [userId, setUserId]     = useState('')
  const [user, setUser]         = useState<User | null>(null)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [testState, setTestState] = useState<'idle' | 'loading' | 'ok' | 'fail'>('idle')
  const [copied, setCopied]     = useState(false)

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
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ...user }),
    })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  async function test() {
    if (!userId || !user) return
    await fetch('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ...user }),
    })
    setTestState('loading')
    const action = user.notificationChannel === 'discord' ? 'test-discord' : 'test-ntfy'
    const res = await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, userId }),
    })
    const { ok } = await res.json()
    setTestState(ok ? 'ok' : 'fail')
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  function set(k: keyof User, v: string) { setUser(u => u ? { ...u, [k]: v } : u) }

  if (!user) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
      <div style={{ width: 20, height: 20, border: '2px solid var(--separator)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
    </div>
  )

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg)',
      paddingBottom: 'calc(var(--nav-height) + env(safe-area-inset-bottom, 0px))',
    }}>

      {/* ─── Navigation bar ─── */}
      <div style={{
        background: 'rgba(242,242,247,0.88)',
        backdropFilter: 'blur(24px) saturate(180%)',
        WebkitBackdropFilter: 'blur(24px) saturate(180%)',
        borderBottom: '0.5px solid rgba(60,60,67,0.2)',
        padding: 'calc(env(safe-area-inset-top, 0px) + 16px) 20px 12px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <h1 style={{ fontWeight: 700, fontSize: 28, color: 'var(--text-primary)', letterSpacing: '-0.6px' }}>設定</h1>
          <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 3, fontWeight: 400 }}>通知先を設定してください</p>
        </div>
      </div>

      <div style={{ padding: '20px 16px 0', maxWidth: 480, margin: '0 auto' }}>

        {/* ─── 通知方法選択 ─── */}
        <p className="section-title" style={{ paddingLeft: 4, marginBottom: 6 }}>通知方法</p>
        <div className="card" style={{ marginBottom: 24, overflow: 'hidden' }}>
          {(['ntfy', 'discord', 'both'] as const).map((ch, i) => (
            <button key={ch} onClick={() => set('notificationChannel', ch)}
              style={{
                width: '100%', padding: '14px 16px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: i < 2 ? '0.5px solid var(--separator)' : 'none',
              }}>
              <span style={{ fontWeight: 400, fontSize: 15, color: 'var(--text-primary)' }}>
                {ch === 'ntfy' ? '📲 ntfy（推奨・完全無料）' : ch === 'discord' ? '💬 Discord' : '🔀 両方'}
              </span>
              {user.notificationChannel === ch ? (
                <span style={{ color: 'var(--accent)', fontSize: 16, fontWeight: 600 }}>✓</span>
              ) : (
                <span style={{ color: 'var(--text-tertiary)', fontSize: 16 }}>›</span>
              )}
            </button>
          ))}
        </div>

        {/* ─── ntfy設定 ─── */}
        {(user.notificationChannel === 'ntfy' || user.notificationChannel === 'both') && (
          <>
            <p className="section-title" style={{ paddingLeft: 4, marginBottom: 6 }}>ntfy 設定</p>
            <div className="card" style={{ marginBottom: 24, overflow: 'hidden' }}>

              {/* Step 1 */}
              <div style={{ padding: '14px 16px', borderBottom: '0.5px solid var(--separator)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                    background: 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 600, color: 'white',
                  }}>1</div>
                  <p style={{ fontWeight: 600, fontSize: 14 }}>アプリをインストール</p>
                </div>
                <div style={{ display: 'flex', gap: 8, marginLeft: 30 }}>
                  <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, textAlign: 'center', padding: '9px', background: 'var(--fill)', borderRadius: 9, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', textDecoration: 'none' }}>
                    🍎 iOS
                  </a>
                  <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, textAlign: 'center', padding: '9px', background: 'var(--fill)', borderRadius: 9, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', textDecoration: 'none' }}>
                    🤖 Android
                  </a>
                </div>
              </div>

              {/* Step 2 */}
              <div style={{ padding: '14px 16px', borderBottom: '0.5px solid var(--separator)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <div style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, background: 'var(--fill-secondary)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>2</div>
                  <p style={{ fontWeight: 600, fontSize: 14 }}>トピック名を設定</p>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10, marginLeft: 30 }}>下記をそのまま使うか、好きな名前に変更できます</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, marginLeft: 30 }}>
                  <code style={{ flex: 1, background: 'var(--accent-light)', color: 'var(--accent)', padding: '9px 12px', borderRadius: 9, fontSize: 13, fontWeight: 500 }}>
                    {suggestedTopic}
                  </code>
                  <button onClick={() => copy(suggestedTopic)}
                    style={{ padding: '9px 14px', background: copied ? 'var(--success)' : 'var(--fill)', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 500, cursor: 'pointer', color: copied ? 'white' : 'var(--text-secondary)', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>
                    {copied ? '✓' : 'コピー'}
                  </button>
                </div>
                <div style={{ marginLeft: 30 }}>
                  <input placeholder="トピック名（英数字・ハイフン）" value={user.ntfyTopic} onChange={e => set('ntfyTopic', e.target.value)} />
                </div>
              </div>

              {/* Step 3 */}
              <div style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, background: 'var(--fill-secondary)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>3</div>
                  <p style={{ fontWeight: 600, fontSize: 14 }}>ntfyアプリで購読する</p>
                </div>
                <ol style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: 14, marginLeft: 30 }}>
                  <li>ntfyアプリを開く</li>
                  <li>右下の「＋」をタップ</li>
                  <li>トピック名を貼り付け</li>
                  <li>「Subscribe」をタップ</li>
                </ol>
              </div>
            </div>
          </>
        )}

        {/* ─── Discord設定 ─── */}
        {(user.notificationChannel === 'discord' || user.notificationChannel === 'both') && (
          <>
            <p className="section-title" style={{ paddingLeft: 4, marginBottom: 6 }}>Discord 設定</p>
            <div className="card" style={{ marginBottom: 24 }}>
              <div style={{ padding: '14px 16px' }}>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10, fontWeight: 400 }}>
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

        {/* ─── Test + Save ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          <button onClick={test} disabled={testState === 'loading'}
            style={{
              padding: '13px', background: 'var(--card)',
              border: '0.5px solid var(--border)', borderRadius: 13,
              fontSize: 14, fontWeight: 500, cursor: 'pointer',
              color: 'var(--text-primary)', fontFamily: 'inherit',
            }}>
            {testState === 'loading' ? '送信中...' : '📨 テスト通知を送信'}
          </button>

          {testState === 'ok' && (
            <div style={{ padding: '11px 14px', background: 'rgba(52,199,89,0.1)', borderRadius: 11, fontSize: 13, color: 'var(--success)', fontWeight: 500 }}>
              ✅ 通知が届きました
            </div>
          )}
          {testState === 'fail' && (
            <div style={{ padding: '11px 14px', background: 'rgba(255,59,48,0.08)', borderRadius: 11, fontSize: 13, color: 'var(--danger)', fontWeight: 400 }}>
              ❌ 届きませんでした。トピック名を確認してください
            </div>
          )}
        </div>

        <button onClick={save} disabled={saving} className="btn-primary">
          {saved ? '✓ 保存しました' : saving ? '保存中...' : '設定を保存する'}
        </button>
      </div>
    </div>
  )
}
