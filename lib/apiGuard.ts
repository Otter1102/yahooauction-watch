/**
 * API セキュリティガード
 * - getIp: Vercel の x-forwarded-for からIPを取得
 * - rateGuard: レート制限。超過時は 429 NextResponse を返す（null = 許可）
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from './rateLimiter'

export function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
}

export function rateGuard(
  key: string,
  maxRequests: number,
  windowMs: number,
): NextResponse | null {
  if (!checkRateLimit(key, maxRequests, windowMs)) {
    return NextResponse.json(
      { error: 'Too Many Requests — しばらく待ってください' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(windowMs / 1000)) } },
    )
  }
  return null
}
