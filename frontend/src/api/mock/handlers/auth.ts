import { http } from 'msw'
import type { LoginRequest, LoginResponse } from '@/api/types'
import { publicUser } from '../db'
import { apiError, json } from '../utils'
import { publicRoute, readJson, route } from './common'

export const authHandlers = [
  http.post(
    '/api/auth/login',
    publicRoute(async ({ db, request }) => {
      const body = await readJson<LoginRequest>(request)
      const email = (body.email ?? '').trim().toLowerCase()
      const user = db.users.find((item) => item.email === email)
      if (!user || body.password !== user.password) {
        return apiError(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль')
      }
      const response: LoginResponse = { access_token: `mock-token-${user.id}`, user: publicUser(user) }
      return json(response)
    }),
  ),
  http.get(
    '/api/auth/me',
    route(({ user }) => json(publicUser(user))),
  ),
]
