/**
 * トライアル Cookie ユーティリティ
 * 署名はサーバーサイドのみ。クライアントからも有効期限を読めるよう non-httpOnly で保存。
 */
export const TRIAL_COOKIE = 'yw_trial'
export const TRIAL_DAYS   = 7

export interface TrialPayload {
  token: string
  exp: string // ISO 8601
}

/** HMAC-SHA256（URL-safe base64）*/
async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/** Cookie 値を生成: base64(payload).hmac */
export async function createTrialCookie(token: string, expiresAt: Date): Promise<string> {
  const payload: TrialPayload = { token, exp: expiresAt.toISOString() }
  const encoded = btoa(JSON.stringify(payload))
  const sig = await hmacSign(encoded, process.env.TRIAL_SECRET!)
  return `${encoded}.${sig}`
}

/** Cookie 値を検証。改ざん or 未設定なら null */
export async function verifyTrialCookie(value: string): Promise<TrialPayload | null> {
  try {
    const dot = value.lastIndexOf('.')
    if (dot < 0) return null
    const encoded = value.slice(0, dot)
    const sig     = value.slice(dot + 1)
    const expected = await hmacSign(encoded, process.env.TRIAL_SECRET!)
    if (expected !== sig) return null
    return JSON.parse(atob(encoded)) as TrialPayload
  } catch {
    return null
  }
}

/** クライアント（JS）からペイロードを読む（署名検証なし、表示用） */
export function parseTrialCookieClient(value: string): TrialPayload | null {
  try {
    const encoded = value.split('.')[0]
    return JSON.parse(atob(encoded)) as TrialPayload
  } catch {
    return null
  }
}

/** 残り秒数（0以下なら期限切れ） */
export function trialSecondsRemaining(payload: TrialPayload): number {
  return Math.floor((new Date(payload.exp).getTime() - Date.now()) / 1000)
}
