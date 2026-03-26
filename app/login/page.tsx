'use client'
import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode]       = useState<'login' | 'signup'>('login')
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone]       = useState(false)

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)

    if (mode === 'login') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) { setError('メールアドレスまたはパスワードが正しくありません'); setLoading(false); return }
      router.push('/')
      router.refresh()
    } else {
      const { error: err } = await supabase.auth.signUp({ email, password })
      if (err) { setError(err.message); setLoading(false); return }
      setDone(true)
    }
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '24px 20px',
    }}>

      {/* Logo */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{
          fontSize: 28, fontWeight: 800, letterSpacing: '-0.5px',
          background: 'var(--grad-primary)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          marginBottom: 4,
        }}>ヤフオクwatch</h1>
        <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: '2px', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>
          {mode === 'login' ? 'Login' : 'Sign Up'}
        </p>
      </div>

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 400,
        background: 'var(--card)',
        borderRadius: 16, padding: '28px 24px',
        boxShadow: 'var(--shadow-card)',
        border: '1px solid var(--border)',
      }}>

        {done ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              確認メールを送信しました
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              受信ボックスをご確認ください。<br />
              確認後にログインできます。
            </p>
            <button onClick={() => { setMode('login'); setDone(false) }}
              style={{ marginTop: 20, fontSize: 13, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              ログイン画面へ
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            {/* Email */}
            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 6, letterSpacing: '0.8px' }}>
                メールアドレス
              </label>
              <input
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="example@email.com"
                style={{ borderRadius: 4 }}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 6, letterSpacing: '0.8px' }}>
                パスワード
              </label>
              <input
                type="password" required value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="8文字以上"
                minLength={8}
              />
            </div>

            {error && (
              <div style={{
                padding: '10px 12px', borderRadius: 8, marginBottom: 16,
                background: 'rgba(246,104,138,0.08)',
                border: '1px solid rgba(246,104,138,0.2)',
                fontSize: 12, color: 'var(--danger)', fontWeight: 500,
              }}>{error}</div>
            )}

            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? '処理中...' : mode === 'login' ? 'ログイン' : '登録する'}
            </button>
          </form>
        )}
      </div>

      {/* Switch mode */}
      {!done && (
        <button
          onClick={() => { setMode(m => m === 'login' ? 'signup' : 'login'); setError('') }}
          style={{
            marginTop: 20, fontSize: 13, color: 'var(--accent)',
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', textDecoration: 'underline',
          }}>
          {mode === 'login' ? '新規登録はこちら' : 'ログインに戻る'}
        </button>
      )}
    </div>
  )
}
