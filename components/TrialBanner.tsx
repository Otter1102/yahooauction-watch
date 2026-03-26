'use client'
import { useEffect, useState } from 'react'
import { parseTrialCookieClient, TRIAL_COOKIE, trialSecondsRemaining } from '@/lib/trial'

function getCookie(name: string): string {
  if (typeof document === 'undefined') return ''
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : ''
}

function fmt(secs: number): string {
  if (secs <= 0) return '期限切れ'
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = secs % 60
  if (d > 0) return `残り ${d}日 ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `残り ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

export default function TrialBanner() {
  const [secs, setSecs] = useState<number | null>(null)

  useEffect(() => {
    const val = getCookie(TRIAL_COOKIE)
    if (!val) return
    const payload = parseTrialCookieClient(val)
    if (!payload) return

    const update = () => setSecs(trialSecondsRemaining(payload))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])

  if (secs === null) return null

  const urgent  = secs < 60 * 60 * 24       // 24時間切り
  const expired = secs <= 0

  return (
    <div style={{
      background: expired
        ? 'rgba(246,104,138,0.12)'
        : urgent
          ? 'rgba(255,149,0,0.10)'
          : 'linear-gradient(91deg, rgba(39,181,212,0.10) 0%, rgba(26,106,201,0.10) 100%)',
      borderBottom: `1px solid ${expired ? 'rgba(246,104,138,0.3)' : urgent ? 'rgba(255,149,0,0.25)' : 'rgba(0,153,226,0.2)'}`,
      padding: '7px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 8,
    }}>
      <span style={{ fontSize: 12, opacity: 0.7 }}>
        {expired ? '⛔' : urgent ? '⚠️' : '⏱'}
      </span>
      <span style={{
        fontSize: 11, fontWeight: 700,
        color: expired ? 'var(--danger)' : urgent ? 'var(--warning)' : 'var(--accent)',
        fontVariantNumeric: 'tabular-nums', letterSpacing: '0.5px',
      }}>
        トライアル版 · {fmt(secs)}
      </span>
    </div>
  )
}
