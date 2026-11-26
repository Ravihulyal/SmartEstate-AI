import { api } from './api'
import type { User } from '../types'

interface LoginResponse {
  success: boolean
  token: string
  user: User
}

interface RegisterResponse {
  success: boolean
  user: User
  message: string
}

interface MeResponse {
  success: boolean
  user: User
}

export async function loginRequest(email: string, password: string): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/auth/login', { email, password })
  return response.data
}

export async function registerRequest(name: string, email: string, password: string, role: 'BUYER' | 'SELLER'): Promise<RegisterResponse> {
  const response = await api.post<RegisterResponse>('/auth/register', { name, email, password, role })
  return response.data
}

export async function getCurrentUser(): Promise<User> {
  const response = await api.get<MeResponse>('/auth/me')
  return response.data.user
}
