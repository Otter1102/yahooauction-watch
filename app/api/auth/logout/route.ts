import { NextResponse } from 'next/server'
import { TRIAL_COOKIE } from '@/lib/trial'

export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete('yw_session')
  res.cookies.delete(TRIAL_COOKIE)
  return res
}
