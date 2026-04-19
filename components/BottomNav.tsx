'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/',         icon: '◎', label: 'ウォッチ' },
  { href: '/history',  icon: '◷', label: '通知履歴' },
  { href: '/settings', icon: '◈', label: '設定' },
]

export default function BottomNav() {
  const path = usePathname()
  return (
    <div className="bottom-nav-outer">
      <nav className="bottom-nav">
        {tabs.map(tab => {
          const active = tab.href === '/' ? path === '/' : path.startsWith(tab.href)
          return (
            <Link key={tab.href} href={tab.href} style={{ textDecoration: 'none' }}>
              <div className={`nav-item${active ? ' active' : ''}`}>
                <span className="nav-icon" style={{
                  lineHeight: 1,
                  fontSize: 20,
                  background: active ? 'var(--grad-primary)' : 'none',
                  WebkitBackgroundClip: active ? 'text' : 'unset',
                  WebkitTextFillColor: active ? 'transparent' : 'inherit',
                  backgroundClip: active ? 'text' : 'unset',
                }}>{tab.icon}</span>
                <span className="nav-label" style={{
                  background: active ? 'var(--grad-primary)' : 'none',
                  WebkitBackgroundClip: active ? 'text' : 'unset',
                  WebkitTextFillColor: active ? 'transparent' : 'inherit',
                  backgroundClip: active ? 'text' : 'unset',
                }}>{tab.label}</span>
              </div>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
