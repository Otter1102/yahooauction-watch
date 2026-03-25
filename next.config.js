/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ['cheerio'] },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.yahoo.co.jp' },
      { protocol: 'https', hostname: '**.yimg.jp' },
    ],
  },
}

module.exports = nextConfig
