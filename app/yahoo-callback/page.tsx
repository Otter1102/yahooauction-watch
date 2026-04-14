'use client'
import { useEffect, useState } from 'react'

export default function YahooCallbackPage() {
  const [status, setStatus] = useState<'closing' | 'redirect'>('closing')

  useEffect(() => {
    // 連携フラグを設定
    try { localStorage.setItem('yahoowatch_yahoo_connected', '1') } catch {}

    // JavaScriptで開いたタブは window.close() で閉じられる
    try { window.close() } catch {}

    // 0.6秒後にまだタブが開いていたらアプリのトップにリダイレクト
    // (iOSではwindow.closeが効かない場合がある)
    const t = setTimeout(() => {
      setStatus('redirect')
      window.location.replace('/')
    }, 600)

    return () => clearTimeout(t)
  }, [])

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'linear-gradient(160deg, #071220 0%, #0c2240 55%, #071220 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px', textAlign: 'center', gap: 20,
    }}>
      {/* アニメーション付きチェックマーク */}
      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        background: 'linear-gradient(135deg, #34c759 0%, #1a9e3f 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 8px 32px rgba(52,199,89,0.45)',
        animation: 'popIn 0.5s cubic-bezier(.17,.67,.33,1.27)',
      }}>
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none"
          stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>

      <div>
        <p style={{ fontSize: 22, fontWeight: 800, color: 'white', margin: '0 0 8px', letterSpacing: '-0.3px' }}>
          ヤフオク連携完了！
        </p>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', margin: 0 }}>
          {status === 'closing' ? 'アプリに戻っています...' : 'アプリを開いています...'}
        </p>
      </div>

      {/* スピナー */}
      <div style={{
        width: 24, height: 24,
        border: '2.5px solid rgba(255,255,255,0.15)',
        borderTopColor: '#27b5d4',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />

      <style>{`
        @keyframes popIn {
          from { transform: scale(0); opacity: 0; }
          60%  { transform: scale(1.15); }
          to   { transform: scale(1); opacity: 1; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
