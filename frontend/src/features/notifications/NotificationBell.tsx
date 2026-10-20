import { Bell } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { IconButton } from '@/shared/ui'
import { useUnreadNotifications } from './useNotifications'
import styles from './NotificationBell.module.css'

export function NotificationBell() {
  const navigate = useNavigate()
  const { data } = useUnreadNotifications()
  const count = data?.length ?? 0
  return (
    <IconButton label={count ? `Уведомления: ${count} непрочитанных` : 'Уведомления'} onClick={() => navigate('/app/notifications')}>
      <Bell size={18} />
      {count > 0 && <span className={styles.count}>{count > 9 ? '9+' : count}</span>}
    </IconButton>
  )
}
