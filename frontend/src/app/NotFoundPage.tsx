import { ArrowUpRight, Compass } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { ButtonLink, EmptyState } from '@/shared/ui'
import { homeFor } from './guards'

export function NotFoundPage() {
  const { user } = useAuth()
  return (
    <EmptyState
      icon={<Compass size={22} />}
      title="Такой страницы нет"
      action={
        <ButtonLink to={user ? homeFor(user.role) : '/login'} variant="secondary" iconRight={<ArrowUpRight size={16} />}>
          На главную
        </ButtonLink>
      }
    >
      Возможно, ссылка устарела. Вернитесь на главную — всё важное там.
    </EmptyState>
  )
}
