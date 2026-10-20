import { request } from '../client'
import type { LoginRequest, LoginResponse, User } from '../types'

export const authApi = {
  login: (body: LoginRequest) => request<LoginResponse>('/auth/login', { method: 'POST', body }),
  me: () => request<User>('/auth/me'),
}
