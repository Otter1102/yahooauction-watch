'use client'

export default function TrialExpiredPage() {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '40px 24px', textAlign: 'center',
    }}>
      <p style={{
        fontSize: 17, fontWeight: 700,
        color: 'var(--text-primary)', margin: 0,
        letterSpacing: '0.2px',
      }}>
        利用トライアル期間終了しました
      </p>
    </div>
  )
}
