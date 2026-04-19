/**
 * 管理者エラー通知モジュール（Gmail SMTP）
 * GitHub Actions の run-check.ts でエラー発生時に管理者へ通知
 * 環境変数: GMAIL_USER, GMAIL_APP_PASSWORD, GMAIL_NOTIFY_TO
 */
import nodemailer from 'nodemailer'

function createTransporter() {
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return null
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })
}

export async function sendAdminErrorAlert(errorMessage: string, detail?: string): Promise<boolean> {
  const to = process.env.GMAIL_NOTIFY_TO
  if (!to) return false
  const transporter = createTransporter()
  if (!transporter) return false

  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
  const text = [
    `[ヤフオクwatch] cron エラー発生`,
    `日時: ${now}`,
    `エラー: ${errorMessage}`,
    detail ? `詳細:\n${detail}` : '',
    `\nGitHub Actions ログを確認してください。`,
  ].filter(Boolean).join('\n')

  try {
    await transporter.sendMail({
      from: `"ヤフオクwatch" <${process.env.GMAIL_USER}>`,
      to,
      subject: `[ヤフオクwatch] cron エラー: ${errorMessage.slice(0, 50)}`,
      text,
    })
    return true
  } catch (err) {
    console.error('[email] エラー通知送信失敗:', err instanceof Error ? err.message : err)
    return false
  }
}
