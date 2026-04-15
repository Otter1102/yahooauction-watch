'use client'
import { useEffect, useRef, useState } from 'react'

interface Props {
  /** DB に保存済みの画像URL（空の場合は /api/thumb から取得） */
  savedUrl: string
  /** フォールバック取得に使うオークションURL */
  auctionUrl: string
  size?: number
  radius?: number
}

/**
 * Yahoo Auction サムネイル
 * - savedUrl があればそれを使用（DBキャッシュ）
 * - なければ IntersectionObserver でビューポートに入ったときに /api/thumb を呼ぶ
 * - 画像エラー時はプレースホルダーを表示
 */
export default function AuctionThumbnail({
  savedUrl, auctionUrl, size = 60, radius = 9,
}: Props) {
  const [src, setSrc] = useState(savedUrl)
  const [imgLoaded, setImgLoaded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const fetchedRef   = useRef(false)

  useEffect(() => {
    // 保存済みURLがあればフェッチ不要
    if (savedUrl) { setSrc(savedUrl); return }
    if (fetchedRef.current) return

    const observer = new IntersectionObserver(
      entries => {
        if (!entries[0].isIntersecting || fetchedRef.current) return
        fetchedRef.current = true
        observer.disconnect()

        fetch(`/api/thumb?url=${encodeURIComponent(auctionUrl)}`)
          .then(r => r.json())
          .then(({ imageUrl }: { imageUrl: string }) => {
            if (imageUrl) setSrc(imageUrl)
          })
          .catch(() => {})
      },
      { rootMargin: '300px' } // スクロール300px手前から先読み
    )

    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [savedUrl, auctionUrl])

  const showPlaceholder = !src || !imgLoaded

  return (
    <div
      ref={containerRef}
      style={{
        width: size, height: size,
        borderRadius: radius,
        flexShrink: 0,
        background: 'var(--fill)',
        overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}
    >
      {/* プレースホルダー（画像がない or 読み込み中） */}
      {showPlaceholder && (
        <span style={{ fontSize: size * 0.38, opacity: 0.22, position: 'absolute' }}>🏷️</span>
      )}

      {/* 実画像 */}
      {src && (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          style={{
            width: size, height: size,
            objectFit: 'cover',
            display: 'block',
            opacity: imgLoaded ? 1 : 0,
            transition: 'opacity 0.2s ease',
          }}
          onLoad={() => setImgLoaded(true)}
          onError={() => { setSrc(''); setImgLoaded(false) }}
        />
      )}
    </div>
  )
}
