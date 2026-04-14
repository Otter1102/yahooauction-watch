import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { randomUUID } from 'crypto'
import { checkRateLimit } from '@/lib/rateLimiter'

const TRIAL_DAYS = 30
const FP_SALT   = process.env.FP_SALT ?? 'ytrial-default-salt-change-me'

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const fp = body?.fp
    const pushEndpoint: string | null = body?.pushEndpoint ?? null
    const localToken: string | null   = body?.localToken   ?? null
    if (!fp || typeof fp !== 'string') {
      return NextResponse.json({ error: 'invalid' }, { status: 400 })
    }

    // IP ベースのレート制限（本番: 10回/分, 開発: 1000回/分）
    const ip = req.headers.get('cf-connecting-ip')
      ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? 'unknown'
    const isLocalDev = process.env.NODE_ENV !== 'production'
    const rateLimit  = isLocalDev ? 1000 : 10
    if (!checkRateLimit(`trial:${ip}`, rateLimit, 60_000)) {
      return NextResponse.json({ error: 'too many requests' }, { status: 429 })
    }

    // サーバーサイドでハッシュ化（クライアントには生データを戻さない）
    const fpHash  = await sha256hex(fp.slice(0, 2000) + FP_SALT)
    const ipHash  = await sha256hex(ip + FP_SALT)

    const cookieId = req.cookies.get('_ytrial')?.value ?? null
    const supabase  = getSupabaseAdmin()

    // 1. フィンガープリントで照合
    let { data: existing } = await supabase
      .from('trial_sessions')
      .select('fp_hash, cookie_id, expires_at')
      .eq('fp_hash', fpHash)
      .maybeSingle()

    // 2. Cookie で照合（FP が変化した場合の救済）
    if (!existing && cookieId) {
      const { data } = await supabase
        .from('trial_sessions')
        .select('fp_hash, cookie_id, expires_at')
        .eq('cookie_id', cookieId)
        .maybeSingle()
      if (data) {
        existing = data
        // FP が変化していれば更新（デバイスの微妙な変化に対応）
        await supabase
          .from('trial_sessions')
          .update({ fp_hash: fpHash })
          .eq('cookie_id', cookieId)
      }
    }

    // 3. push_endpoint で照合（同一ブラウザの別userId試行を検知）
    if (!existing && pushEndpoint) {
      const { data } = await supabase
        .from('trial_sessions')
        .select('fp_hash, cookie_id, expires_at')
        .eq('push_endpoint', pushEndpoint)
        .maybeSingle()
      if (data) {
        existing = data
        // fp が変化していれば更新
        await supabase
          .from('trial_sessions')
          .update({ fp_hash: fpHash })
          .eq('push_endpoint', pushEndpoint)
      }
    }

    // 4. localToken で照合（localStorage/IndexedDB/CacheStorage 由来。Cookie 削除後の救済）
    if (!existing && localToken && /^[0-9a-f-]{36}$/.test(localToken)) {
      const { data } = await supabase
        .from('trial_sessions')
        .select('fp_hash, cookie_id, expires_at')
        .eq('cookie_id', localToken)
        .maybeSingle()
      if (data) {
        existing = data
        // fp が変化していれば更新
        await supabase
          .from('trial_sessions')
          .update({ fp_hash: fpHash })
          .eq('cookie_id', localToken)
      }
    }

    let expiresAt: string
    let resolvedCookieId = cookieId

    if (existing) {
      expiresAt = existing.expires_at
      resolvedCookieId = existing.cookie_id ?? resolvedCookieId
      // Cookie ID が未設定なら付与
      if (!existing.cookie_id) {
        resolvedCookieId = randomUUID()
        await supabase
          .from('trial_sessions')
          .update({ cookie_id: resolvedCookieId })
          .eq('fp_hash', fpHash)
      }
      // push_endpoint が来たら記録（後から取得した場合）
      if (pushEndpoint) {
        await supabase
          .from('trial_sessions')
          .update({ push_endpoint: pushEndpoint })
          .eq('fp_hash', fpHash)
      }
    } else {
      // 新規トライアル登録
      resolvedCookieId = randomUUID()
      expiresAt = new Date(Date.now() + TRIAL_DAYS * 86400_000).toISOString()
      await supabase.from('trial_sessions').upsert({
        fp_hash: fpHash,
        ip_hash: ipHash,
        cookie_id: resolvedCookieId,
        expires_at: expiresAt,
        ...(pushEndpoint ? { push_endpoint: pushEndpoint } : {}),
      })
    }

    const secondsLeft = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
    // clientToken: クライアント側マルチストレージ（localStorage/IDB/Cache）に保存させる
    // Cookie が削除されても localToken で再マッチングできる
    const res = NextResponse.json({ secondsLeft, expired: secondsLeft === 0, clientToken: resolvedCookieId })

    // httpOnly Cookie を発行（365日有効・再インストール後も残る）
    if (resolvedCookieId) {
      res.cookies.set('_ytrial', resolvedCookieId, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 365 * 86400,
        path: '/',
      })
    }

    return res
  } catch {
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
