'use client'

import { getDeviceFingerprint, IS_TRIAL as TRIAL_MODE } from '@/lib/fingerprint'

type EnsurePushOptions = {
  forceRefresh?: boolean
  requestPermission?: boolean
}

export type EnsurePushResult =
  | { ok: true; refreshed: boolean }
  | { ok: false; reason: 'unsupported' | 'denied' | 'default' | 'missing-key' | 'save-failed' | 'error'; message?: string }

function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr.buffer
}

export async function savePushSubscription(userId: string, sub: PushSubscription): Promise<{ ok: true } | { ok: false; message: string }> {
  const j = sub.toJSON()
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      endpoint: j.endpoint,
      p256dh: j.keys?.p256dh,
      auth: j.keys?.auth,
      deviceFingerprint: getDeviceFingerprint(),
      isTrial: TRIAL_MODE,
    }),
  })
  if (res.ok) return { ok: true }
  const data = await res.json().catch(() => ({}))
  return { ok: false, message: data.error ?? data.message ?? String(res.status) }
}

export async function ensurePushSubscription(userId: string, options: EnsurePushOptions = {}): Promise<EnsurePushResult> {
  if (!userId || typeof window === 'undefined') return { ok: false, reason: 'error', message: 'missing userId' }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { ok: false, reason: 'unsupported' }
  }

  try {
    let permission = Notification.permission
    if (permission === 'default' && options.requestPermission) {
      permission = await Notification.requestPermission()
    }
    if (permission === 'default') return { ok: false, reason: 'default' }
    if (permission !== 'granted') return { ok: false, reason: 'denied' }

    const { publicKey } = await fetch('/api/push/vapid-key').then(r => r.json())
    if (!publicKey) return { ok: false, reason: 'missing-key' }

    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    await navigator.serviceWorker.ready

    const existingSub = await reg.pushManager.getSubscription()
    if (existingSub && options.forceRefresh) {
      await existingSub.unsubscribe().catch(() => false)
    }
    const currentSub = options.forceRefresh ? null : existingSub
    const sub = currentSub ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })

    const saved = await savePushSubscription(userId, sub)
    if (!saved.ok) return { ok: false, reason: 'save-failed', message: saved.message }

    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, notificationChannel: 'webpush' }),
    }).catch(() => {})

    return { ok: true, refreshed: !!options.forceRefresh }
  } catch (err) {
    return { ok: false, reason: 'error', message: String(err) }
  }
}
