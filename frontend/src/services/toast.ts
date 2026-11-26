export function notify(message: string, kind: 'success' | 'error' = 'success') {
  window.dispatchEvent(new CustomEvent('smartestate:toast', { detail: { message, kind } }))
}
