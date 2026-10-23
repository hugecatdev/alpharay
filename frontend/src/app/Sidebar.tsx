import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import {
  BarChart3,
  Bell,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  FilePlus2,
  Files,
  FlaskConical,
  Inbox,
  LayoutGrid,
} from 'lucide-react'
import type { Role } from '@/api'
import { useUnreadNotifications } from '@/features/notifications/useNotifications'
import { cn } from '@/shared/lib/cn'
import styles from './Sidebar.module.css'

interface NavItem {
  to: string
  label: string
  icon: ReactNode
  end?: boolean
  badge?: number
  accent?: boolean
}

function useNavItems(role: Role): NavItem[] {
  const unread = useUnreadNotifications(role === 'CLIENT')
  if (role === 'UNDERWRITER') {
    return [
      { to: '/bank', label: 'Очередь заявок', icon: <Inbox size={19} />, end: true },
      { to: '/bank/stats', label: 'Статистика', icon: <BarChart3 size={19} /> },
    ]
  }
  return [
    { to: '/app', label: 'Главная', icon: <LayoutGrid size={19} />, end: true },
    { to: '/app/applications/new', label: 'Новая заявка', icon: <FilePlus2 size={19} />, accent: true },
    { to: '/app/applications', label: 'Мои заявки', icon: <Files size={19} />, end: true },
    { to: '/app/notifications', label: 'Уведомления', icon: <Bell size={19} />, badge: unread.data?.length },
    { to: '/app/company', label: 'Компания', icon: <Building2 size={19} /> },
  ]
}

export function Sidebar({ role, collapsed, onToggle }: { role: Role; collapsed: boolean; onToggle?: () => void }) {
  const items = useNavItems(role)
  return (
    <aside className={cn(styles.sidebar, collapsed && styles.collapsed)} aria-label="Навигация">
      <nav className={styles.nav}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) => cn(styles.item, item.accent && styles.accent, isActive && styles.active)}
          >
            <span className={styles.icon}>{item.icon}</span>
            <span className={styles.label}>{item.label}</span>
            {item.badge ? <b className={styles.badge}>{item.badge > 9 ? '9+' : item.badge}</b> : null}
          </NavLink>
        ))}
      </nav>
      <div className={styles.bottom}>
        <p className={styles.demo} title="Демонстрационный прототип: данные синтетические, проверки, подписание и выдача смоделированы">
          <span className={styles.icon}>
            <FlaskConical size={16} />
          </span>
          <span className={styles.label}>Демо: данные синтетические, проверки, подпись и выдача смоделированы</span>
        </p>
        {onToggle && (
          <button
            type="button"
            className={styles.utility}
            onClick={onToggle}
            aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
            title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          >
            {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
            <span className={styles.label}>Свернуть меню</span>
          </button>
        )}
      </div>
    </aside>
  )
}
