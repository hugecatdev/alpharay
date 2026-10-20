import { createBrowserRouter, Navigate } from 'react-router-dom'
import { LoginPage } from '@/features/auth/LoginPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { CompanyPage } from '@/features/company/CompanyPage'
import { ApplicationsListPage } from '@/features/application/ApplicationsListPage'
import { ApplicationWizard } from '@/features/application/ApplicationWizard'
import { ApplicationPage } from '@/features/application/ApplicationPage'
import { SignPage } from '@/features/application/SignPage'
import { NotificationsPage } from '@/features/notifications/NotificationsPage'
import { QueuePage } from '@/features/bank/QueuePage'
import { BankApplicationPage } from '@/features/bank/BankApplicationPage'
import { StatsPage } from '@/features/bank/StatsPage'
import { AnonymousOnly, RequireRole, RootRedirect } from './guards'
import { AppShell } from './AppShell'
import { NotFoundPage } from './NotFoundPage'

export const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },
  {
    path: '/login',
    element: (
      <AnonymousOnly>
        <LoginPage />
      </AnonymousOnly>
    ),
  },
  {
    path: '/app',
    element: (
      <RequireRole role="CLIENT">
        <AppShell role="CLIENT" />
      </RequireRole>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'applications', element: <ApplicationsListPage /> },
      { path: 'applications/new', element: <ApplicationWizard /> },
      { path: 'applications/:id/edit', element: <ApplicationWizard /> },
      { path: 'applications/:id', element: <ApplicationPage /> },
      { path: 'applications/:id/sign', element: <SignPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'company', element: <CompanyPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    path: '/bank',
    element: (
      <RequireRole role="UNDERWRITER">
        <AppShell role="UNDERWRITER" />
      </RequireRole>
    ),
    children: [
      { index: true, element: <QueuePage /> },
      { path: 'applications/:id', element: <BankApplicationPage /> },
      { path: 'stats', element: <StatsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])
