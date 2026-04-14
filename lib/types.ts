export interface PushSub {
  endpoint: string
  p256dh: string
  auth: string
}

export interface User {
  id: string
  ntfyTopic: string
  discordWebhook: string
  notificationChannel: 'webpush' | 'ntfy' | 'discord' | 'both'
  pushSub?: PushSub | null
}

export interface SearchCondition {
  id: string
  userId: string
  name: string
  keyword: string
  maxPrice: number
  minPrice: number
  minBids: number
  maxBids: number | null  // null = 上限なし, 設定時は「minBids以上maxBids未満」でフィルター
  sellerType: 'all' | 'store' | 'individual'
  itemCondition: 'all' | 'new' | 'used'
  sortBy: 'endTime' | 'bids' | 'price'
  sortOrder: 'asc' | 'desc'
  buyItNow: boolean | null  // null = 両方（オークション+即決）, false = オークションのみ, true = 即決のみ
  enabled: boolean
  createdAt: string
  lastCheckedAt?: string
  lastFoundCount?: number
}

export interface AuctionItem {
  auctionId: string
  title: string
  price: string
  priceInt: number | null
  bids: number | null
  isBuyItNow: boolean
  remaining: string | null
  endtimeMs: number | null  // オークション終了時刻（Unix ms）。24時間フィルターに使用
  url: string
  imageUrl: string
  pubDate: string
}

export interface NotificationRecord {
  id: string
  userId: string
  conditionId: string
  conditionName: string
  auctionId: string
  title: string
  price: string
  url: string
  imageUrl: string
  notifiedAt: string
  remaining: string | null
}

export const DEFAULT_USER: Omit<User, 'id'> = {
  ntfyTopic: '',
  discordWebhook: '',
  notificationChannel: 'webpush',
}
