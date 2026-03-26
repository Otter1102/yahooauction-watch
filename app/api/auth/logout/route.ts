import { NextResponse } from 'next/server'
import { TRIAL_COOKIE } from '@/lib/trial'

/** ログアウト: Supabase セッション Cookie + トライアル Cookie を削除してリダイレクト */
export async function POST() {
  const res = NextResponse.redirect(
    new URL('/login', process.env.NEXT_PUBLIC_APP_URL ?? 'https://yahooauction-watch.vercel.app'),
  )
  // Supabase auth cookies (sb-*-auth-token)
  res.cookies.delete('sb-access-token')
  res.cookies.delete('sb-refresh-token')
  // Trial cookie
  res.cookies.delete(TRIAL_COOKIE)
  return res
}
