import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import type { Role } from '@/api'
import { AssistantPanel } from '@/features/assistant/AssistantPanel'
import { AssistantProvider, useAssistant } from '@/features/assistant/AssistantProvider'
import { cn } from '@/shared/lib/cn'
import { useLocalStorage } from '@/shared/hooks/useLocalStorage'
import { useMediaQuery } from '@/shared/hooks/useMediaQuery'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import styles from './AppShell.module.css'

function ShellLayout({ role }: { role: Role }) {
  const [collapsed, setCollapsed] = useLocalStorage('alpharay-sidebar-collapsed', true)
  const { enabled, open } = useAssistant()
  const location = useLocation()
  const narrow = useMediaQuery('(max-width: 1280px)')

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  const withAssistant = enabled && open
  const compact = collapsed || (withAssistant && narrow)
  return (
    <div className={styles.shell}>
      <Header role={role} />
      <div
        className={cn(
          styles.body,
          compact && styles.collapsed,
          withAssistant && styles.withAssistant,
        )}
      >
        <Sidebar role={role} collapsed={compact} onToggle={withAssistant && narrow ? undefined : () => setCollapsed(!collapsed)} />
        <main className={styles.main} id="main">
          <div className={cn(styles.content, role === 'UNDERWRITER' && styles.wide)}>
            <Outlet />
          </div>
        </main>
        {enabled && <AssistantPanel />}
      </div>
    </div>
  )
}

export function AppShell({ role }: { role: Role }) {
  return (
    <AssistantProvider>
      <ShellLayout role={role} />
    </AssistantProvider>
  )
}
