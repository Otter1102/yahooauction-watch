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
  const [userId, setUserId]       = useState('')
  const [user, setUser]           = useState<User | null>(null)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [testState, setTestState] = useState<'idle' | 'loading' | 'ok' | 'fail'>('idle')
  const [copied, setCopied]       = useState(false)

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
      <div style={{ width: 20, height: 20, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
    </div>
  )

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg)',
      paddingBottom: 'calc(var(--nav-height) + env(safe-area-inset-bottom, 0px))',
    }}>

      {/* ─── Header ─── */}
      <div style={{
        background: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border)',
        padding: 'calc(env(safe-area-inset-top, 0px) + 14px) 20px 14px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <h1 style={{
            fontWeight: 700, fontSize: 20, letterSpacing: '-0.3px',
            background: 'var(--grad-primary)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>設定</h1>
          <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2, fontWeight: 400 }}>通知先を設定してください</p>
        </div>
      </div>

      <div style={{ padding: '20px 16px 0', maxWidth: 480, margin: '0 auto' }}>

        {/* ─── 通知方法 ─── */}
        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', paddingLeft: 4, marginBottom: 6, letterSpacing: '0.8px', textTransform: 'uppercase' }}>通知方法</p>
        <div style={{ background: 'var(--card)', borderRadius: 12, marginBottom: 24, overflow: 'hidden', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)' }}>
          {(['ntfy', 'discord', 'both'] as const).map((ch, i) => (
            <button key={ch} onClick={() => set('notificationChannel', ch)}
              style={{
                width: '100%', padding: '14px 16px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: user.notificationChannel === ch ? 'rgba(0,153,226,0.05)' : 'none',
                border: 'none', cursor: 'pointer',
                borderBottom: i < 2 ? '1px solid var(--border)' : 'none',
                transition: 'background 0.15s',
              }}>
              <span style={{ fontWeight: user.notificationChannel === ch ? 600 : 400, fontSize: 14, color: 'var(--text-primary)' }}>
                {ch === 'ntfy' ? 'ntfy（推奨・完全無料）' : ch === 'discord' ? 'Discord Webhook' : '両方'}
              </span>
              {user.notificationChannel === ch ? (
                <span style={{ color: 'var(--accent)', fontSize: 14, fontWeight: 700 }}>✓</span>
              ) : (
                <span style={{ color: 'var(--text-tertiary)', fontSize: 16 }}>›</span>
              )}
            </button>
          ))}
        </div>

        {/* ─── ntfy設定 ─── */}
        {(user.notificationChannel === 'ntfy' || user.notificationChannel === 'both') && (
          <>
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', paddingLeft: 4, marginBottom: 6, letterSpacing: '0.8px', textTransform: 'uppercase' }}>ntfy 設定</p>
            <div style={{ background: 'var(--card)', borderRadius: 12, marginBottom: 24, overflow: 'hidden', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)' }}>

              {/* Step 1 */}
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: 11, flexShrink: 0,
                    background: 'var(--grad-primary)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: 'white',
                  }}>1</div>
                  <p style={{ fontWeight: 600, fontSize: 14 }}>アプリをインストール</p>
                </div>
                <div style={{ display: 'flex', gap: 8, marginLeft: 32 }}>
                  <a href="https://apps.apple.com/app/ntfy/id1625396347" target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, textAlign: 'center', padding: '9px', background: 'var(--fill)', borderRadius: 8, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', textDecoration: 'none', border: '1px solid var(--border)' }}>
                    iOS App
                  </a>
                  <a href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, textAlign: 'center', padding: '9px', background: 'var(--fill)', borderRadius: 8, fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', textDecoration: 'none', border: '1px solid var(--border)' }}>
                    Android App
                  </a>
                </div>
              </div>

              {/* Step 2 */}
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 11, flexShrink: 0, background: 'var(--fill)', border: '1px solid var(--input-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>2</div>
                  <p style={{ fontWeight: 600, fontSize: 14 }}>トピック名を設定</p>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10, marginLeft: 32 }}>下記をそのまま使うか、好きな名前に変更できます</p>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, marginLeft: 32 }}>
                  <code style={{ flex: 1, background: 'rgba(0,153,226,0.06)', color: 'var(--accent)', padding: '9px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: '1px solid rgba(0,153,226,0.2)' }}>
                    {suggestedTopic}
                  </code>
                  <button onClick={() => copy(suggestedTopic)}
                    style={{ padding: '9px 14px', background: copied ? 'var(--accent)' : 'var(--fill)', border: copied ? 'none' : '1px solid var(--input-border)', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: copied ? 'white' : 'var(--text-secondary)', whiteSpace: 'nowrap', transition: 'all 0.2s', fontFamily: 'inherit' }}>
                    {copied ? '✓' : 'コピー'}
                  </button>
                </div>
                <div style={{ marginLeft: 32 }}>
                  <input placeholder="トピック名（英数字・ハイフン）" value={user.ntfyTopic} onChange={e => set('ntfyTopic', e.target.value)} />
                </div>
              </div>

              {/* Step 3 */}
              <div style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ width: 22, height: 22, borderRadius: 11, flexShrink: 0, background: 'var(--fill)', border: '1px solid var(--input-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>3</div>
                  <p style={{ fontWeight: 600, fontSize: 14 }}>ntfyアプリで購読する</p>
                </div>
                <ol style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 2, paddingLeft: 14, marginLeft: 32 }}>
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
            <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', paddingLeft: 4, marginBottom: 6, letterSpacing: '0.8px', textTransform: 'uppercase' }}>Discord 設定</p>
            <div style={{ background: 'var(--card)', borderRadius: 12, marginBottom: 24, boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border)' }}>
              <div style={{ padding: '14px 16px' }}>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, fontWeight: 400 }}>
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
              height: 44, background: 'var(--card)',
              border: '1px solid var(--border)', borderRadius: 22,
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              color: 'var(--accent)', fontFamily: 'inherit',
              letterSpacing: '0.3px',
            }}>
            {testState === 'loading' ? '送信中...' : 'テスト通知を送信'}
          </button>

          {testState === 'ok' && (
            <div style={{ padding: '11px 14px', background: 'rgba(52,199,89,0.08)', borderRadius: 10, fontSize: 13, color: '#1a7a3a', fontWeight: 600, border: '1px solid rgba(52,199,89,0.2)' }}>
              通知が届きました
            </div>
          )}
          {testState === 'fail' && (
            <div style={{ padding: '11px 14px', background: 'rgba(246,104,138,0.07)', borderRadius: 10, fontSize: 13, color: 'var(--danger)', fontWeight: 500, border: '1px solid rgba(246,104,138,0.2)' }}>
              届きませんでした。トピック名を確認してください
            </div>
          )}
        </div>

        <button onClick={save} disabled={saving} className="btn-primary">
          {saved ? '保存しました' : saving ? '保存中...' : '設定を保存する'}
        </button>
      </div>
    </div>
  )
}
