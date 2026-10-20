import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut, Moon, Sun, UserRound } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { companyApi, queryKeys, type Role } from '@/api'
import { useAuth, useCurrentUser } from '@/features/auth/AuthProvider'
import { NotificationBell } from '@/features/notifications/NotificationBell'
import { useTheme } from '@/shared/hooks/useTheme'
import { cn } from '@/shared/lib/cn'
import { IconButton, Logo } from '@/shared/ui'
import styles from './Header.module.css'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function ProfileMenu({ role }: { role: Role }) {
  const user = useCurrentUser()
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const company = useQuery({ queryKey: queryKeys.company, queryFn: companyApi.get, enabled: role === 'CLIENT' })

  useEffect(() => {
    if (!open) return
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const subtitle = role === 'CLIENT' ? company.data?.name ?? user.email : user.position

  return (
    <div className={styles.profile} ref={ref}>
      <button type="button" className={styles.profileButton} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={styles.avatar}>{initials(user.full_name)}</span>
        <span className={styles.profileText}>
          <strong>{user.email}</strong>
          <span>{subtitle}</span>
        </span>
        <ChevronDown size={16} className={styles.chevron} />
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <div className={styles.menuHead}>
            <strong>{user.full_name}</strong>
            <span>{user.position}</span>
          </div>
          {role === 'CLIENT' && (
            <Link to="/app/company" className={styles.menuItem} role="menuitem" onClick={() => setOpen(false)}>
              <UserRound size={16} /> Профиль компании
            </Link>
          )}
          <button
            type="button"
            className={styles.menuItem}
            role="menuitem"
            onClick={() => {
              logout()
              navigate('/login', { replace: true })
            }}
          >
            <LogOut size={16} /> Выйти
          </button>
        </div>
      )}
    </div>
  )
}

function useScrolled(): boolean {
  const [scrolled, setScrolled] = useState(() => window.scrollY > 4)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return scrolled
}

export function Header({ role }: { role: Role }) {
  const { theme, toggle } = useTheme()
  const scrolled = useScrolled()
  return (
    <header className={cn(styles.header, scrolled && styles.scrolled)}>
      <Link to={role === 'CLIENT' ? '/app' : '/bank'} className={styles.brand} aria-label="AlphaRay — на главную">
        <Logo size="md" />
      </Link>
      <span className={styles.caption}>{role === 'CLIENT' ? 'Кредитный кабинет' : 'Кабинет андеррайтера'}</span>
      <div className={styles.right}>
        <IconButton label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'} onClick={toggle}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </IconButton>
        {role === 'CLIENT' && <NotificationBell />}
        <ProfileMenu role={role} />
      </div>
    </header>
  )
}
