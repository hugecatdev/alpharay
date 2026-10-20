import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import type { Role } from '@/api'
import { useAuth } from '@/features/auth/AuthProvider'
import { PageLoader } from '@/shared/ui'

export function homeFor(role: Role): string {
  return role === 'UNDERWRITER' ? '/bank' : '/app'
}

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return <PageLoader />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />
  return <>{children}</>
}

export function RootRedirect() {
  const { user, status } = useAuth()
  if (status === 'loading') return <PageLoader />
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />
}

export function AnonymousOnly({ children }: { children: ReactNode }) {
  const { user, status } = useAuth()
  if (status === 'loading') return <PageLoader />
  if (user) return <Navigate to={homeFor(user.role)} replace />
  return <>{children}</>
}
