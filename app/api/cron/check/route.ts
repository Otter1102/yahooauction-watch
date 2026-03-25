// このエンドポイントは使用しません
// 定期実行は GitHub Actions の scripts/run-check.ts が担当します
import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({ message: 'Use GitHub Actions for scheduled checks' })
}
