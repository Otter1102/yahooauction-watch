'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/',         icon: '🔍', label: 'ウォッチ' },
  { href: '/history',  icon: '🔔', label: '通知履歴' },
  { href: '/settings', icon: '⚙️',  label: '設定' },
]

export default function BottomNav() {
  const path = usePathname()
  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
      width: '100%', maxWidth: 480,
      background: 'rgba(255,255,255,0.92)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      paddingBottom: 'env(safe-area-inset-bottom, 0)',
      zIndex: 100,
    }}>
      {tabs.map(tab => {
        const active = tab.href === '/' ? path === '/' : path.startsWith(tab.href)
        return (
          <Link key={tab.href} href={tab.href} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            padding: '10px 0 8px',
            color: active ? 'var(--accent)' : 'var(--text-tertiary)',
            textDecoration: 'none',
            transition: 'color 0.15s',
          }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>{tab.icon}</span>
            <span style={{
              fontSize: 10, fontWeight: active ? 700 : 500, marginTop: 3,
              letterSpacing: '0.02em',
            }}>{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
