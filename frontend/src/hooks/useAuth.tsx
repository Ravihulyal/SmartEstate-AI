import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getCurrentUser, loginRequest, registerRequest } from '../services/auth'
import { TOKEN_KEY } from '../services/api'
import type { User } from '../types'
import { AuthContext } from './authContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(() => Boolean(window.localStorage.getItem(TOKEN_KEY)))

  const logout = useCallback(() => {
    window.localStorage.removeItem(TOKEN_KEY)
    setUser(null)
  }, [])

  useEffect(() => {
    const handleExpired = () => setUser(null)
    window.addEventListener('smartestate:session-expired', handleExpired)
    const token = window.localStorage.getItem(TOKEN_KEY)
    if (token) {
      getCurrentUser()
        .then(setUser)
        .catch(() => {
          setUser(null)
        })
        .finally(() => setLoading(false))
    }
    return () => window.removeEventListener('smartestate:session-expired', handleExpired)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginRequest(email, password)
    window.localStorage.setItem(TOKEN_KEY, result.token)
    setUser(result.user)
    return result.user
  }, [])

  const register = useCallback(async (name: string, email: string, password: string, role: 'BUYER' | 'SELLER') => {
    await registerRequest(name, email, password, role)
  }, [])

  const value = useMemo(() => ({ user, loading, login, register, logout }), [user, loading, login, register, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
