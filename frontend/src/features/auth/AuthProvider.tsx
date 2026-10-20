import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { authApi, getToken, onUnauthorized, setToken, type User } from '@/api'

type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

interface AuthState {
  user: User | null
  status: AuthStatus
  login: (email: string, password: string) => Promise<User>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthStatus>(getToken() ? 'loading' : 'anonymous')

  useEffect(() => {
    if (!getToken()) return
    let cancelled = false
    authApi
      .me()
      .then((me) => {
        if (cancelled) return
        setUser(me)
        setStatus('authenticated')
      })
      .catch(() => {
        if (cancelled) return
        setToken(null)
        setUser(null)
        setStatus('anonymous')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(
    () =>
      onUnauthorized(() => {
        setUser(null)
        setStatus('anonymous')
        queryClient.clear()
      }),
    [queryClient],
  )

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await authApi.login({ email, password })
      setToken(response.access_token)
      queryClient.clear()
      setUser(response.user)
      setStatus('authenticated')
      return response.user
    },
    [queryClient],
  )

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    setStatus('anonymous')
    queryClient.clear()
    try {
      sessionStorage.removeItem('alpharay-assistant-session')
    } catch {
      return
    }
  }, [queryClient])

  const value = useMemo(() => ({ user, status, login, logout }), [user, status, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}

export function useCurrentUser(): User {
  const { user } = useAuth()
  if (!user) throw new Error('User is not authenticated')
  return user
}
