'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Service Worker から postMessage({type:'NAVIGATE', url:'/history'}) を受け取り、
 * Next.js router でソフトナビゲーション（白画面なし）を実行するハンドラー。
 *
 * layout.tsx の <script> タグが 'sw-navigate' CustomEvent を dispatch し、
 * このコンポーネントがそれを受け取って router.push() に変換する。
 */
export default function SWNavigationHandler() {
  const router = useRouter()

  useEffect(() => {
    // マウント時: postMessage が React より先に届いていた場合のフォールバック
    // （iOS PWA でアプリがサスペンドから復帰する際に発生する白画面の修正）
    try {
      const pending = sessionStorage.getItem('sw-pending-navigate')
      if (pending) {
        sessionStorage.removeItem('sw-pending-navigate')
        router.push(pending)
        return
      }
    } catch {}

    const handler = (e: Event) => {
      const url = (e as CustomEvent<{ url: string }>).detail?.url
      if (url) router.push(url)
    }
    window.addEventListener('sw-navigate', handler)
    return () => window.removeEventListener('sw-navigate', handler)
  }, [router])

  return null
}
