import axios from 'axios'

export const TOKEN_KEY = 'smartestate_token'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:5000/api/v1',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
})

api.interceptors.request.use((config) => {
  const token = window.localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401 && window.localStorage.getItem(TOKEN_KEY)) {
      window.localStorage.removeItem(TOKEN_KEY)
      window.dispatchEvent(new CustomEvent('smartestate:session-expired'))
      window.dispatchEvent(new CustomEvent('smartestate:toast', { detail: { message: 'Your session expired. Please sign in again.', kind: 'error' } }))
    }
    return Promise.reject(error)
  },
)

export function getErrorMessage(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) return fallback
  const data: unknown = error.response?.data
  if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
    return data.message
  }
  if (error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK') {
    return 'Could not reach SmartEstate. Check that the backend is running and try again.'
  }
  return fallback
}
