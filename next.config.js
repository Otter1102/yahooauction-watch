/** @type {import('next').NextConfig} */
const nextConfig = {
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
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',        value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
          { key: 'X-Robots-Tag',           value: 'noindex, nofollow, noarchive' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https://*.yahoo.co.jp https://*.yimg.jp",
              "connect-src 'self' https://*.supabase.co https://ntfy.sh https://discord.com",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
