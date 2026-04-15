'use client'
import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('AppError:', error)
  }, [error])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '60dvh', padding: '24px',
      gap: '16px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 40 }}>⚠️</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
        一時的なエラーが発生しました
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        通信エラーの可能性があります。再試行してください。
      </div>
      <button
        onClick={reset}
        style={{
          background: 'var(--accent)', color: '#fff', border: 'none',
          borderRadius: 10, padding: '10px 24px', fontSize: 14,
          fontWeight: 600, cursor: 'pointer',
        }}
      >
        再試行
      </button>
    </div>
  )
}
