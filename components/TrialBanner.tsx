'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getStoredToken, setStoredToken } from '@/lib/trial-storage-client'

function fmt(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const hms = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return d > 0 ? `残り${d}日 ${hms}` : `残り${hms}`
}

async function fingerprint(): Promise<string> {
  const p: string[] = [
    navigator.language ?? '',
    screen.width + 'x' + screen.height,
    String(screen.colorDepth),
    String(window.devicePixelRatio),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    String(navigator.hardwareConcurrency ?? 0),
    String(navigator.maxTouchPoints ?? 0),
    navigator.platform ?? '',
  ]
  // Canvas fingerprint（GPU依存・ブラウザデータ削除後も同値）
  try {
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')
    if (ctx) {
      ctx.textBaseline = 'top'
      ctx.font = '13px system-ui'
      ctx.fillStyle = '#0099E2'
      ctx.fillText('ywt\u30e9\u30a4\u30a2\u30eb', 2, 2)
      p.push(c.toDataURL().slice(-64))
    }
  } catch { /* canvas blocked → skip */ }
  // WebGL renderer（GPU固有値・プライベートモードでも同値）
  try {
    const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      if (ext) {
        p.push(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '')
        p.push(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) ?? '')
      }
    }
  } catch { /* WebGL blocked → skip */ }
  return p.join('|')
}

async function getPushEndpoint(): Promise<string | null> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/sw.js')
    if (!reg) return null
    const sub = await reg.pushManager?.getSubscription()
    return sub?.endpoint ?? null
  } catch { return null }
}

export default function TrialBanner() {
  const router = useRouter()
  const [sec, setSec] = useState<number | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setInterval>

    Promise.all([fingerprint(), getPushEndpoint(), getStoredToken()]).then(([fp, pushEndpoint, localToken]) =>
      fetch('/api/trial/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fp, pushEndpoint, localToken }),
      })
        .then(r => r.json())
        .then(async (data) => {
          // サーバーから返ってきたトークンをマルチストレージに保存
          if (data.clientToken) {
            await setStoredToken(data.clientToken)
          }
          if (data.expired || data.secondsLeft === 0) {
            router.replace('/trial-expired')
            return
          }
          setSec(data.secondsLeft)
          timer = setInterval(() => {
            setSec(prev => {
              if (prev === null || prev <= 1) {
                clearInterval(timer)
                router.replace('/trial-expired')
                return 0
              }
              return prev - 1
            })
          }, 1000)
        })
        .catch(() => { /* ネットワークエラーは無視 */ })
    )

    return () => clearInterval(timer)
  }, [router])

  if (sec === null) return null

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: 'linear-gradient(90deg, #c0392b, #e74c3c, #c0392b)',
      color: 'white', textAlign: 'center',
      padding: '7px 16px',
      fontSize: 12, fontWeight: 800,
      letterSpacing: '0.3px',
      boxShadow: '0 2px 10px rgba(192,57,43,0.5)',
      fontFamily: 'system-ui, sans-serif',
    }}>
      🆓 無料トライアル中 &nbsp;|&nbsp; {fmt(sec)}
      <span style={{ marginLeft: 12, fontSize: 11, fontWeight: 600, opacity: 0.85 }}>
        （条件5件まで）
      </span>
    </div>
  )
}
