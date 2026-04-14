'use client'

export default function TrialExpiredPage() {
  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '40px 24px', background: 'var(--bg)', textAlign: 'center',
    }}>
      <div style={{ fontSize: 64, marginBottom: 20 }}>⏰</div>
      <h1 style={{
        fontSize: 22, fontWeight: 800,
        color: 'var(--text-primary)', margin: '0 0 8px',
      }}>
        トライアル期間が終了しました
      </h1>
      <p style={{
        fontSize: 14, color: 'var(--text-secondary)',
        lineHeight: 1.8, marginBottom: 8, maxWidth: 320,
      }}>
        30日間の無料トライアルをご利用いただきありがとうございます。
      </p>
      <p style={{
        fontSize: 13, color: 'var(--text-tertiary)',
        lineHeight: 1.7, marginBottom: 36, maxWidth: 300,
      }}>
        引き続きご利用いただくには、永久ライセンスをご購入ください。購入後は監視条件を最大30個まで登録できます。
      </p>

      <a
        href="https://lp-paid.vercel.app/"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'block', width: '100%', maxWidth: 320,
          padding: '17px 24px',
          background: 'linear-gradient(135deg, #0099E2, #1a6ac9)',
          color: 'white', textDecoration: 'none',
          borderRadius: 28, fontSize: 16, fontWeight: 800,
          boxShadow: '0 4px 20px rgba(0,153,226,0.4)',
          animation: 'btnPulse 2s ease-in-out infinite',
        }}
      >
        🛒 永久ライセンスを購入する
      </a>

      <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 14 }}>
        購入後は条件30個まで・月額なし・永続利用
      </p>
    </div>
  )
}
