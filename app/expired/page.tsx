export default function NotFoundPage() {
  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '24px 32px', textAlign: 'center',
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: 20, marginBottom: 24,
        background: 'linear-gradient(135deg, rgba(0,153,226,0.10) 0%, rgba(26,106,201,0.10) 100%)',
        border: '1px solid rgba(0,153,226,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 36,
      }}>
        🔍
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
        ヤフオクwatch
      </h1>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.75, maxWidth: 300 }}>
        このページは存在しません。<br />
        <a href="/" style={{ color: 'var(--accent)', textDecoration: 'none' }}>ホームに戻る</a>
      </p>
    </div>
  )
}
