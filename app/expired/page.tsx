import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'アクセス期限切れ — ヤフオクwatch' }

interface Props {
  searchParams: { [key: string]: string | string[] | undefined }
}

export default function ExpiredPage({ searchParams }: Props) {
  const isUsed = searchParams.reason === 'used'

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
        background: 'linear-gradient(135deg, rgba(246,104,138,0.12) 0%, rgba(26,106,201,0.10) 100%)',
        border: '1px solid rgba(246,104,138,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 36,
      }}>
        {isUsed ? '🔒' : '⏰'}
      </div>

      <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10, letterSpacing: '-0.3px' }}>
        {isUsed ? 'このリンクは使用済みです' : 'トライアル期間が終了しました'}
      </h1>

      <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.75, maxWidth: 300 }}>
        {isUsed
          ? 'このトライアルURLはすでに別のデバイスで使用されています。新しい試用URLが必要な場合はお問い合わせください。'
          : '7日間のトライアル期間が終了しました。引き続きご利用いただくには、管理者にお問い合わせください。'
        }
      </p>

      <div style={{
        marginTop: 32, padding: '16px 20px',
        background: 'var(--card)', borderRadius: 12,
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
        fontSize: 13, color: 'var(--text-tertiary)', maxWidth: 300,
      }}>
        <p style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>ヤフオクwatch</p>
        <p style={{ fontWeight: 400, lineHeight: 1.6 }}>
          正式版のご利用・お申し込みについては<br />管理者までご連絡ください。
        </p>
      </div>
    </div>
  )
}
