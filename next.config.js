/** @type {import('next').NextConfig} */
const nextConfig = {
  // ソースマップを本番で無効化（クライアントJSからソースを逆引きされないようにする）
  productionBrowserSourceMaps: false,

  experimental: { serverComponentsExternalPackages: ['cheerio'] },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.yahoo.co.jp' },
      { protocol: 'https', hostname: '**.yimg.jp' },
    ],
  },

  async headers() {
    return [
      {
        // /_next/static/ を除く全リクエスト（HTMLページ・API）に no-cache を設定
        // 静的JSチャンクは hash-based なので除外してOK（パフォーマンス維持）
        source: '/((?!_next/static).*)',
        headers: [
          { key: 'Cache-Control',             value: 'no-cache, must-revalidate' },
          { key: 'X-Frame-Options',           value: 'DENY' },
          { key: 'X-Content-Type-Options',    value: 'nosniff' },
          { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
          { key: 'X-Robots-Tag',              value: 'noindex, nofollow, noarchive' },
          // HSTS: HTTPS接続を強制（1年間）
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          // Permissions-Policy: 不要な機能を無効化
          { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Next.jsのhydration等でunsafe-inline/evalが必要だがframe-ancestorsで埋め込みをブロック
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              // 画像: Yahoo/yimgのみ許可（外部画像の無制限読み込みを防止）
              "img-src 'self' data: https://*.yahoo.co.jp https://*.yimg.jp",
              // API接続先を明示的に制限
              "connect-src 'self' https://*.supabase.co https://ntfy.sh https://discord.com",
              "worker-src 'self'",
              // フレーム埋め込み完全禁止（クリックジャッキング防止）
              "frame-ancestors 'none'",
              // フォームはself以外に送信不可
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
