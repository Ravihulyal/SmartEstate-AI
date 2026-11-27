import { io, type Socket } from 'socket.io-client'
import { TOKEN_KEY } from './api'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:5000/api/v1'
const SOCKET_URL = new URL(API_BASE_URL, window.location.origin).origin

export function createAuthenticatedSocket(): Socket | null {
  const token = window.localStorage.getItem(TOKEN_KEY)
  return token ? io(SOCKET_URL, { auth: { token } }) : null
}
