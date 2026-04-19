/**
 * メール通知モジュール（Gmail SMTP）
 * GitHub Actions の run-check.ts から呼ばれる（Node.js 環境専用）
 * 環境変数: GMAIL_USER, GMAIL_APP_PASSWORD
 */
import nodemailer from 'nodemailer'
import { AuctionItem } from './types'

function createTransporter() {
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return null
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })
}

export async function sendEmailSummary(
  toEmail: string,
  count: number,
  items: AuctionItem[],
): Promise<boolean> {
  if (!toEmail) return false
  const transporter = createTransporter()
  if (!transporter) return false

  const itemRows = items.slice(0, 10).map(item =>
    `<tr>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;">
        ${item.imageUrl ? `<img src="${item.imageUrl}" width="60" height="60" style="object-fit:cover;border-radius:4px;vertical-align:middle;" />` : ''}
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #eee;font-size:13px;line-height:1.5;">
        <a href="${item.url}" style="color:#0099E2;text-decoration:none;font-weight:600;">${item.title.slice(0, 60)}</a><br/>
        <span style="color:#333;">💰 ${item.price}</span>
        ${item.bids != null ? ` &nbsp;🔨 ${item.bids}件` : ''}
        ${item.remaining ? ` &nbsp;⏰ ${item.remaining}` : ''}
      </td>
    </tr>`
  ).join('')

  const moreText = items.length > 10
    ? `<p style="color:#888;font-size:12px;margin:8px 0 0;">... 他 ${items.length - 10} 件</p>`
    : ''

  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#F3F7F8;font-family:sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:20px 12px;">
    <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
      <div style="background:linear-gradient(91deg,#27B5D4,#1D9BD7,#1A6AC9);padding:20px 20px 16px;">
        <p style="margin:0;color:white;font-size:18px;font-weight:700;">🔔 新着 ${count} 件</p>
        <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:12px;">ヤフオクwatch</p>
      </div>
      <div style="padding:0 8px;">
        <table style="width:100%;border-collapse:collapse;">
          ${itemRows}
        </table>
        ${moreText}
      </div>
      <div style="padding:16px 20px;border-top:1px solid #eee;">
        <a href="https://yahooauction-watch.vercel.app/" style="display:block;text-align:center;background:linear-gradient(91deg,#27B5D4,#1A6AC9);color:white;text-decoration:none;padding:12px;border-radius:8px;font-weight:700;font-size:14px;">アプリで確認する</a>
      </div>
    </div>
    <p style="text-align:center;color:#aaa;font-size:11px;margin:12px 0 0;">メール通知を停止するには設定ページでアドレスを削除してください</p>
  </div>
</body>
</html>`

  try {
    await transporter.sendMail({
      from: `"ヤフオクwatch" <${process.env.GMAIL_USER}>`,
      to: toEmail,
      subject: `【ヤフオクwatch】新着 ${count} 件が見つかりました`,
      html,
    })
    return true
  } catch (err) {
    console.error('[email] 送信失敗:', err instanceof Error ? err.message : err)
    return false
  }
}
