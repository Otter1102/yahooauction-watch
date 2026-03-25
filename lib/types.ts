export interface User {
  id: string
  ntfyTopic: string
  discordWebhook: string
  notificationChannel: 'ntfy' | 'discord' | 'both'
}

export interface SearchCondition {
  id: string
  userId: string
  name: string
  keyword: string
  maxPrice: number
  minPrice: number
  minBids: number
  sellerType: 'all' | 'store' | 'individual'
  itemCondition: 'all' | 'new' | 'used'
  sortBy: 'endTime' | 'bids' | 'price'
  sortOrder: 'asc' | 'desc'
  buyItNow: boolean
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
  remaining: string | null
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
  notifiedAt: string
}

export const DEFAULT_USER: Omit<User, 'id'> = {
  ntfyTopic: '',
  discordWebhook: '',
  notificationChannel: 'ntfy',
}
