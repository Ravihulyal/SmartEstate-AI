import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'

interface ToastMessage {
  id: number
  message: string
  kind: 'success' | 'error'
}

export function ToastContainer() {
  const [messages, setMessages] = useState<ToastMessage[]>([])

  useEffect(() => {
    const handleToast = (event: Event) => {
      const detail = (event as CustomEvent<{ message: string; kind: ToastMessage['kind'] }>).detail
      const id = Date.now() + Math.random()
      setMessages((current) => [...current, { id, ...detail }])
      window.setTimeout(() => setMessages((current) => current.filter((item) => item.id !== id)), 3800)
    }
    window.addEventListener('smartestate:toast', handleToast)
    return () => window.removeEventListener('smartestate:toast', handleToast)
  }, [])

  return (
    <div className="toast-stack" aria-live="polite">
      {messages.map((item) => (
        <div className={`toast ${item.kind === 'error' ? 'toast-error' : ''}`} role="status" key={item.id}>
          {item.kind === 'success' && <CheckCircle2 size={16} style={{ verticalAlign: 'middle', marginRight: 8 }} />}
          {item.message}
        </div>
      ))}
    </div>
  )
}
