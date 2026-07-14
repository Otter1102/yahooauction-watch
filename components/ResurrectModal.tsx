'use client'
import { useState } from 'react'
import { ensurePushSubscription } from '@/lib/push-client'

interface Props {
  userId: string
  /** モーダルを閉じる（後で表示しないフラグは呼び出し側で管理） */
  onClose: () => void
  /** 条件追加フォームを開く */
  onOpenConditionForm: () => void
}

type Status = 'idle' | 'loading' | 'done' | 'denied' | 'unsupported' | 'error'

export default function ResurrectModal({ userId, onClose, onOpenConditionForm }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState<string>('')

  async function handleEnable() {
    if (!userId) return
    setStatus('loading')
    setErrorMsg('')

    try {
      const result = await ensurePushSubscription(userId, {
        requestPermission: true,
        forceRefresh: true, // 旧 push_sub は Neon にないので必ず作り直す
      })
      if (result.ok) {
        setStatus('done')
        return
      }
      if (result.reason === 'unsupported') { setStatus('unsupported'); return }
      if (result.reason === 'denied' || result.reason === 'default') { setStatus('denied'); return }
      setStatus('error')
      setErrorMsg(result.message ?? result.reason)
    } catch (e) {
      setStatus('error')
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }

  function handleStartAddCondition() {
    onClose()
    onOpenConditionForm()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        zIndex: 300,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        padding: '20px 16px calc(env(safe-area-inset-bottom, 0px) + 20px)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--card)',
          borderRadius: 20,
          padding: '24px 22px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          animation: 'yw-slide-up 0.3s ease-out',
        }}
      >
        <style>{`
          @keyframes yw-slide-up {
            from { transform: translateY(24px); opacity: 0; }
            to   { transform: translateY(0);    opacity: 1; }
          }
        `}</style>

        {/* ─── ヘッダー ─── */}
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div
            style={{
              width: 60, height: 60, borderRadius: 18, margin: '0 auto 14px',
              background: 'linear-gradient(135deg, rgba(255,193,7,0.16) 0%, rgba(255,152,0,0.18) 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 30,
            }}
          >
            🛠
          </div>
          <h2 style={{
            fontSize: 18, fontWeight: 700,
            color: 'var(--text-primary)',
            letterSpacing: '-0.2px', lineHeight: 1.35, marginBottom: 6,
          }}>
            サーバー移行のお知らせ
          </h2>
          <p style={{
            fontSize: 13, color: 'var(--text-secondary)',
            lineHeight: 1.7, fontWeight: 400,
          }}>
            通知基盤をアップグレードしました。<br />
            お手数ですが、以下 2 ステップで再有効化してください（1 分で完了）。
          </p>
        </div>

        {/* ─── STEP 1 : 通知再有効化 ─── */}
        <div style={{
          background: 'var(--bg)', borderRadius: 14,
          padding: '14px 14px 16px',
          marginBottom: 10,
          border: status === 'done' ? '1.5px solid var(--accent)' : '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{
              width: 22, height: 22, borderRadius: 11,
              background: status === 'done' ? 'var(--accent)' : 'var(--fill)',
              color: status === 'done' ? 'white' : 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
            }}>
              {status === 'done' ? '✓' : '1'}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              通知を再有効化
            </span>
          </div>
          <p style={{
            fontSize: 12, color: 'var(--text-tertiary)',
            lineHeight: 1.65, marginBottom: 12,
          }}>
            旧サーバーの購読情報が引き継げないため、下のボタンでプッシュ通知の紐付けをやり直します。
          </p>

          {status !== 'done' && (
            <button
              onClick={handleEnable}
              disabled={status === 'loading'}
              className="btn-primary"
              style={{
                width: '100%', height: 44, fontSize: 14,
                opacity: status === 'loading' ? 0.7 : 1,
                cursor: status === 'loading' ? 'default' : 'pointer',
              }}
            >
              {status === 'loading' ? '再有効化中...' : '通知を再有効化する'}
            </button>
          )}

          {status === 'done' && (
            <div style={{
              fontSize: 12, color: 'var(--accent)',
              fontWeight: 600, textAlign: 'center', padding: '6px 0',
            }}>
              通知の再有効化が完了しました
            </div>
          )}

          {status === 'denied' && (
            <p style={{
              fontSize: 11, color: 'var(--danger)',
              marginTop: 10, lineHeight: 1.55,
            }}>
              通知が許可されていません。iPhone/iPad の場合、Safari ではなく<b>ホーム画面に追加した PWA アイコンから</b>開いて、通知許可のダイアログで「許可」を選んでください。
            </p>
          )}
          {status === 'unsupported' && (
            <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 10, lineHeight: 1.55 }}>
              このブラウザは Web Push に対応していません。PWA を再インストールしてお試しください。
            </p>
          )}
          {status === 'error' && (
            <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 10, lineHeight: 1.55 }}>
              エラー: {errorMsg}
            </p>
          )}
        </div>

        {/* ─── STEP 2 : 条件再登録 ─── */}
        <div style={{
          background: 'var(--bg)', borderRadius: 14,
          padding: '14px 14px 16px',
          marginBottom: 18,
          border: '1px solid var(--border)',
          opacity: status === 'done' ? 1 : 0.55,
          transition: 'opacity 0.2s',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{
              width: 22, height: 22, borderRadius: 11,
              background: 'var(--fill)', color: 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
            }}>
              2
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              監視条件を再登録
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.65, marginBottom: 12 }}>
            以前登録していた条件（キーワード / 上限価格など）を新サーバーへ移行できませんでした。
            お手数ですが、思い出せる範囲で再登録してください。
          </p>
          <button
            onClick={handleStartAddCondition}
            disabled={status !== 'done'}
            style={{
              width: '100%', height: 44, borderRadius: 12,
              border: '1px solid rgba(0,153,226,0.28)',
              background: status === 'done' ? 'rgba(0,153,226,0.08)' : 'var(--fill)',
              color: status === 'done' ? 'var(--accent)' : 'var(--text-tertiary)',
              fontWeight: 700, fontSize: 14,
              cursor: status === 'done' ? 'pointer' : 'default',
              fontFamily: 'inherit',
            }}
          >
            条件を追加する
          </button>
        </div>

        {/* ─── 閉じるリンク ─── */}
        <button
          onClick={onClose}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-tertiary)',
            fontSize: 12, fontWeight: 500,
            padding: '8px 0',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          あとで対応する
        </button>
      </div>
    </div>
  )
}
